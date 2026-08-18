import assert from "node:assert";
import { test } from "node:test";
import { compareCodeGraphs } from "../lib/analysis/graph-diff.ts";
import type { CodeGraphV2 } from "../lib/domain/code-graph.ts";

function createGraph(
  files: string[],
  symbols: { name: string; exported?: boolean; path: string }[],
  routes: string[],
): CodeGraphV2 {
  return {
    schemaVersion: "2.0",
    snapshot: {
      provider: "github",
      repository: { owner: "owner", name: "repo" },
      requestedRef: "main",
      commitSha: "1111111111111111111111111111111111111111",
      treeSha: "2222222222222222222222222222222222222222",
      manifest: [],
    },
    limits: { maxFiles: 100, maxSizeBytes: 100000, maxTotalBytes: 5000000 },
    coverage: {
      discoveredFiles: files.length,
      analyzedFiles: files.length,
      skippedFiles: 0,
      truncation: false,
    },
    metrics: { files: files.length, symbols: symbols.length, routes: routes.length, packages: 0 },
    diagnostics: [],
    nodes: [
      ...files.map((f) => ({
        id: `file:${f}`,
        kind: "file" as const,
        name: f,
        location: { path: f },
        metadata: { path: f },
      })),
      ...symbols.map((s) => ({
        id: `sym:${s.path}:${s.name}`,
        kind: "symbol" as const,
        name: s.name,
        location: { path: s.path },
        metadata: { symbolKind: "function", exported: s.exported ?? false },
      })),
      ...routes.map((r) => ({
        id: `route:${r}`,
        kind: "route" as const,
        name: r,
        location: { path: "app/api/route.ts" },
        metadata: { path: r, methods: ["GET"] },
      })),
    ],
    edges: [],
  };
}

test("compareCodeGraphs computes added, removed, and modified node diffs", () => {
  const base = createGraph(
    ["src/a.ts", "src/b.ts"],
    [{ name: "foo", exported: true, path: "src/a.ts" }],
    ["GET /api/users"],
  );
  const target = createGraph(
    ["src/a.ts", "src/c.ts"],
    [
      { name: "foo", exported: true, path: "src/a.ts" },
      { name: "bar", exported: false, path: "src/c.ts" },
    ],
    ["GET /api/posts"],
  );

  const diff = compareCodeGraphs(base, target);

  assert.equal(diff.summary.addedFiles, 1);
  assert.equal(diff.summary.removedFiles, 1);
  assert.equal(diff.summary.addedSymbols, 1);
  assert.equal(diff.summary.removedRoutes, 1);
  assert.ok(diff.summary.breakingWarnings.some((w) => w.includes("GET /api/users")));
});
