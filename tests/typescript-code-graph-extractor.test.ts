import assert from "node:assert/strict";
import test from "node:test";
import { extractTypeScriptCodeGraph } from "../lib/analysis/typescript-code-graph-extractor.ts";
import { parseCodeGraph } from "../lib/analysis/code-graph-contract.ts";
import {
  repositorySnapshotLimits,
  type RepositorySnapshot,
} from "../lib/domain/repository-snapshot.ts";

function fixture(files: Record<string, string>): {
  snapshot: RepositorySnapshot;
  files: { path: string; content: string }[];
} {
  const entries = Object.entries(files);
  const bytes = entries.reduce((total, [, content]) => total + Buffer.byteLength(content), 0);
  return {
    snapshot: {
      snapshotId: "snapshot-typescript",
      provider: "github",
      repositoryId: "github:example/project",
      requestedRef: "main",
      commitSha: "1".repeat(40),
      treeSha: "2".repeat(40),
      manifest: entries.map(([path, content], index) => ({
        path,
        kind: "blob",
        mode: "100644",
        gitObjectSha: (index + 3).toString(16).padStart(40, "0"),
        size: Buffer.byteLength(content),
        eligibleForAnalysis: true,
      })),
      limits: repositorySnapshotLimits,
      coverage: {
        discoveredFiles: entries.length,
        analyzedFiles: entries.length,
        skippedFiles: 0,
        discoveredBytes: bytes,
        analyzedBytes: bytes,
        truncated: false,
      },
    },
    files: entries.map(([path, content]) => ({ path, content })),
  };
}

function symbols(graph: ReturnType<typeof extractTypeScriptCodeGraph>): Map<string, string> {
  return new Map(
    graph.nodes
      .filter((node) => node.kind === "symbol")
      .map((node) => [node.name, node.metadata.symbolKind]),
  );
}

test("extracts declarations and containment with strict deterministic evidence", () => {
  const input = fixture({
    "src/model.ts": `export interface Shape { area(): number }
export type Id = string
export enum Color { Red }
export const value = 1
export default class Box implements Shape {
  constructor(public size: number) {}
  get areaValue() { return this.size }
  set areaValue(value: number) { this.size = value }
  area() { return this.size * this.size }
}`,
  });
  const graph = extractTypeScriptCodeGraph(input);
  assert.deepStrictEqual(parseCodeGraph(graph), graph);
  const found = symbols(graph);
  for (const [name, kind] of [
    ["Shape", "interface"],
    ["Id", "type"],
    ["Color", "enum"],
    ["value", "variable"],
    ["Box", "class"],
    ["constructor", "constructor"],
    ["area", "method"],
  ])
    assert.equal(found.get(name), kind);
  assert.deepStrictEqual(
    graph.nodes
      .filter(
        (node): node is Extract<(typeof graph.nodes)[number], { kind: "symbol" }> =>
          node.kind === "symbol" && node.name === "areaValue",
      )
      .map((node) => node.metadata.symbolKind)
      .sort(),
    ["getter", "setter"],
  );
  assert.ok(graph.edges.some((edge) => edge.kind === "declares"));
  assert.ok(graph.edges.some((edge) => edge.kind === "contains"));
  assert.ok(graph.edges.every((edge) => edge.evidence.every((item) => item.startLine)));
});

test("resolves internal, JS-to-TS, package, type, dynamic, require, and unresolved modules", () => {
  const input = fixture({
    "src/main.ts": `import type { User } from "./types"
import { helper } from "./helper.js"
export { User as PublicUser } from "./types"
import express from "express"
const missing = require("./missing")
import("./lazy")
helper()`,
    "src/types.ts": "export interface User { id: string }",
    "src/helper.ts": "export function helper() {}",
    "src/lazy/index.ts": "export const lazy = true",
  });
  const graph = extractTypeScriptCodeGraph(input);
  const imports = graph.edges.filter((edge) => edge.kind === "imports" || edge.kind === "requires");
  assert.ok(
    imports.some(
      (edge) => edge.metadata?.mode === "type" && edge.metadata.resolution === "resolved",
    ),
  );
  assert.ok(
    imports.some(
      (edge) =>
        edge.metadata?.specifier === "./helper.js" && edge.metadata.resolution === "resolved",
    ),
  );
  assert.ok(imports.some((edge) => edge.metadata?.resolution === "external"));
  assert.ok(imports.some((edge) => edge.metadata?.mode === "dynamic"));
  assert.ok(imports.some((edge) => edge.metadata?.resolution === "unresolved"));
  assert.ok(
    graph.nodes.some((node) => node.kind === "package" && node.name === "unresolved:./missing"),
  );
  assert.ok(graph.diagnostics.some((item) => item.code === "MODULE_UNRESOLVED"));
});

test("extracts repository calls, extends, implements, Express, and Next routes", () => {
  const input = fixture({
    "src/base.ts": `export interface Service { run(): void }
export class Base {}`,
    "src/app.ts": `import { Base, Service } from "./base"
export function work() {}
export class Worker extends Base implements Service { run() { work() } }
app.get("/users", work)
router.post('/users', work)`,
    "app/api/items/route.ts": `export function GET() {}
export async function POST() {}`,
    "pages/api/health.ts": "export default function handler() {}",
  });
  const graph = extractTypeScriptCodeGraph(input);
  assert.ok(graph.edges.some((edge) => edge.kind === "calls"));
  assert.ok(graph.edges.some((edge) => edge.kind === "extends"));
  assert.ok(graph.edges.some((edge) => edge.kind === "implements"));
  const routes = graph.nodes.filter((node) => node.kind === "route");
  assert.ok(
    routes.some((node) => node.name === "GET /users" && node.metadata.framework === "Express"),
  );
  assert.ok(
    routes.some((node) => node.name === "POST /api/items" && node.metadata.framework === "Next.js"),
  );
  assert.ok(routes.some((node) => node.name === "ALL /api/health"));
});

test("resolves commented tsconfig aliases with deterministic pattern and target precedence", () => {
  const graph = extractTypeScriptCodeGraph(
    fixture({
      "tsconfig.json": `{
        // aliases
        "compilerOptions": {
          "baseUrl": ".",
          "paths": { "@/*": ["fallback/*", "src/*"], "@/core/*": ["core/*"], },
        },
      }`,
      "src/main.ts": `import { value } from "@/core/value"; value()`,
      "core/value.ts": `export function value() {}`,
      "fallback/core/value.ts": `export function value() {}`,
      "src/core/value.ts": `export function value() {}`,
    }),
  );
  const edge = graph.edges.find(
    (item) => item.kind === "imports" && item.metadata?.specifier === "@/core/value",
  );
  const target = graph.nodes.find((item) => item.id === edge?.to);
  assert.equal(target?.kind, "file");
  assert.equal(target?.location?.path, "core/value.ts");
  assert.deepStrictEqual(edge?.metadata?.candidates, ["core/value.ts"]);
});

test("extracts Next root, grouped, parallel, page routes and only exported handlers", () => {
  const graph = extractTypeScriptCodeGraph(
    fixture({
      "app/route.ts": `export function GET() {}; function POST() {}`,
      "app/(shop)/@modal/items/route.ts": `export const POST = () => {}`,
      "app/(site)/about/page.tsx": `export default function Page() { return null }`,
    }),
  );
  const routes = graph.nodes.filter((item) => item.kind === "route");
  assert.deepStrictEqual(routes.map((item) => item.name).sort(), [
    "GET /",
    "GET /about",
    "POST /items",
  ]);
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.kind === "handles-route" &&
        graph.nodes.find((item) => item.id === edge.from)?.name === "GET",
    ),
  );
});

test("links Express final handlers, property and new calls, and test callbacks", () => {
  const graph = extractTypeScriptCodeGraph(
    fixture({
      "src/service.ts": `export class Service { run() {} }; export function named() {}`,
      "src/app.test.ts": `import { Service, named } from "./service"
const service = new Service()
service.run()
app.get("/named", middleware, named)
router.post("/inline", middleware, (_req, res) => res.end())
test("named", () => named())`,
    }),
  );
  const nodeById = new Map(graph.nodes.map((item) => [item.id, item]));
  const routeEdges = graph.edges.filter((item) => item.kind === "handles-route");
  assert.ok(routeEdges.some((item) => nodeById.get(item.from)?.name === "named"));
  assert.ok(routeEdges.some((item) => nodeById.get(item.from)?.name.startsWith("<route-handler:")));
  const called = graph.edges
    .filter((item) => item.kind === "calls")
    .map((item) => nodeById.get(item.to)?.name);
  assert.ok(called.includes("Service"));
  assert.ok(called.includes("run"));
  assert.ok(
    graph.edges.some((item) => item.kind === "tests" && nodeById.get(item.to)?.name === "named"),
  );
});

test("diagnoses unsupported files, unresolved and nonliteral imports", () => {
  const graph = extractTypeScriptCodeGraph(
    fixture({
      "src/main.ts": `const path = "./dynamic"; import(path); require("./missing")`,
      "src/styles.css": `body { color: red }`,
    }),
  );
  assert.ok(graph.diagnostics.some((item) => item.code === "SOURCE_FILE_UNSUPPORTED"));
  assert.ok(graph.diagnostics.some((item) => item.code === "MODULE_SPECIFIER_UNSUPPORTED"));
  assert.ok(graph.diagnostics.some((item) => item.code === "MODULE_UNRESOLVED"));
  assert.equal(graph.coverage.analyzedFiles, 2);
});

test("ignores syntax-like comments and strings and is permutation deterministic", () => {
  const input = fixture({
    "src/a.ts": `const text = "import fake from 'fake'; app.get('/fake', fn)"
// require("comment-package")
/* class Ghost {} */
export function real() {}`,
    "src/b.ts": "import { real } from './a'; real()",
  });
  const first = extractTypeScriptCodeGraph(input);
  const second = extractTypeScriptCodeGraph({
    snapshot: { ...input.snapshot, manifest: [...input.snapshot.manifest].reverse() },
    files: [...input.files].reverse(),
  });
  assert.deepStrictEqual(second, first);
  assert.equal(
    first.nodes.some((node) => node.kind === "symbol" && node.name === "Ghost"),
    false,
  );
  assert.equal(
    first.nodes.some((node) => node.kind === "route" && node.name.includes("/fake")),
    false,
  );
  assert.equal(
    first.nodes.some((node) => node.kind === "package" && node.name.includes("comment-package")),
    false,
  );
});
