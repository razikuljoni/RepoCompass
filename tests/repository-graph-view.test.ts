import assert from "node:assert/strict";
import test from "node:test";
import {
  architectureGraphSummary,
  fileGraphDetails,
  findRelatedGraphNodes,
  impactedFiles,
  overviewGraphHealth,
} from "../lib/analysis/repository-graph-view.ts";
import { codeGraphLimits, type CodeGraphV2 } from "../lib/domain/code-graph.ts";
import { repositorySnapshotLimits } from "../lib/domain/repository-snapshot.ts";

const graph: CodeGraphV2 = {
  schemaVersion: "2.0",
  snapshot: {
    snapshotId: "snapshot-1",
    provider: "github",
    repositoryId: "github:example/project",
    requestedRef: "main",
    commitSha: "a".repeat(40),
    treeSha: "b".repeat(40),
    manifest: [],
    limits: repositorySnapshotLimits,
    coverage: {
      discoveredFiles: 3,
      analyzedFiles: 3,
      skippedFiles: 0,
      discoveredBytes: 0,
      analyzedBytes: 0,
      truncated: false,
    },
  },
  limits: codeGraphLimits,
  coverage: { analyzedFiles: 3, totalFiles: 3, percentage: 100, truncated: false },
  metrics: { nodeCount: 4, edgeCount: 3, diagnosticCount: 0 },
  diagnostics: [],
  nodes: [
    {
      id: "file:core",
      kind: "file",
      name: "core.ts",
      location: { path: "src/core.ts" },
      metadata: { path: "src/core.ts" },
    },
    {
      id: "symbol:core",
      kind: "symbol",
      name: "core",
      location: { path: "src/core.ts", startLine: 2 },
      metadata: { symbolKind: "function" },
    },
    {
      id: "file:feature",
      kind: "file",
      name: "feature.ts",
      location: { path: "src/feature.ts" },
      metadata: { path: "src/feature.ts" },
    },
    {
      id: "file:test",
      kind: "file",
      name: "core.test.ts",
      location: { path: "test/core.test.ts" },
      metadata: { path: "test/core.test.ts" },
    },
  ],
  edges: [
    {
      id: "contains",
      from: "file:core",
      to: "symbol:core",
      kind: "contains",
      provenance: "EXTRACTED",
      evidence: [],
    },
    {
      id: "imports",
      from: "file:feature",
      to: "file:core",
      kind: "imports",
      provenance: "EXTRACTED",
      evidence: [{ path: "src/feature.ts", startLine: 1 }],
    },
    {
      id: "tests",
      from: "file:test",
      to: "symbol:core",
      kind: "tests",
      provenance: "EXTRACTED",
      evidence: [{ path: "test/core.test.ts", startLine: 3 }],
    },
  ],
};

test("builds file evidence and bounded incoming impact", () => {
  const details = fileGraphDetails(graph, "src/core.ts");
  assert.deepStrictEqual(
    details.symbols.map((node) => node.name),
    ["core"],
  );
  assert.deepStrictEqual(
    details.relationships.map((item) => [item.kind, item.path]),
    [
      ["imports", "src/feature.ts"],
      ["tests", "test/core.test.ts"],
    ],
  );
  assert.deepStrictEqual(impactedFiles(graph, "src/core.ts"), [
    { path: "src/feature.ts", depth: 1, kinds: ["imports"] },
    { path: "test/core.test.ts", depth: 1, kinds: ["tests"] },
  ]);
});

test("overviewGraphHealth computes diagnostics, coverage, and score", () => {
  const result = overviewGraphHealth(graph);
  assert.ok(result);
  assert.deepStrictEqual(result.diagnostics, {
    syntaxErrors: 0,
    unresolvedImports: 0,
    unsupportedFiles: 0,
  });
  assert.deepStrictEqual(result.coverage, {
    totalFiles: 3,
    analyzedFiles: 3,
    skippedFiles: 0,
    truncated: false,
  });
  assert.strictEqual(result.healthScore, 100);
});

test("overviewGraphHealth returns null for v1 graphs", () => {
  const v1 = { schemaVersion: "1.0" as const, snapshot: graph.snapshot, nodes: [], edges: [] };
  assert.strictEqual(overviewGraphHealth(v1), null);
});

test("overviewGraphHealth penalizes errors and skipped files", () => {
  const dirty: CodeGraphV2 = {
    ...graph,
    diagnostics: [
      { code: "SYNTAX_ERROR", severity: "error", message: "bad" },
      { code: "IMPORT_UNRESOLVED", severity: "warning", message: "missing" },
      { code: "IMPORT_UNRESOLVED", severity: "warning", message: "missing2" },
    ],
    coverage: { analyzedFiles: 2, totalFiles: 10, percentage: 0.2, truncated: true },
    metrics: { nodeCount: 4, edgeCount: 3, diagnosticCount: 3 },
  };
  const result = overviewGraphHealth(dirty);
  assert.ok(result);
  assert.deepStrictEqual(result.diagnostics, {
    syntaxErrors: 1,
    unresolvedImports: 2,
    unsupportedFiles: 0,
  });
  assert.deepStrictEqual(result.coverage, {
    totalFiles: 10,
    analyzedFiles: 2,
    skippedFiles: 8,
    truncated: true,
  });
  assert.strictEqual(result.healthScore, 0);
});

test("architectureGraphSummary computes topDirectories, hubs, and flows", () => {
  const summary = architectureGraphSummary(graph);
  assert.ok(summary);
  assert.strictEqual(summary.topDirectories.length, 2);
  assert.ok(summary.hubs.length > 0);
  assert.strictEqual(summary.hubs[0].path, "src/core.ts");
  assert.strictEqual(summary.hubs[0].fanIn, 2);
  assert.strictEqual(summary.hubs[0].fanOut, 0);
  assert.strictEqual(summary.flows.length, 1);
  assert.deepStrictEqual(summary.flows[0], { fromDir: "test", toDir: "src", count: 1 });
});

test("findRelatedGraphNodes matches nodes by path", () => {
  const nodes = findRelatedGraphNodes(graph, "src/core.ts");
  assert.strictEqual(nodes.length, 2);
  assert.deepStrictEqual(
    nodes.map((n) => n.id),
    ["file:core", "symbol:core"],
  );
  assert.strictEqual(findRelatedGraphNodes(graph, "nonexistent.ts").length, 0);
});
