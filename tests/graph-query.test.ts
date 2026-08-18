import assert from "node:assert/strict";
import test from "node:test";
import { parseGraphQuery } from "../lib/analysis/graph-query-contract.ts";
import { canonicalGraphJson, executeGraphQuery } from "../lib/analysis/graph-query-engine.ts";
import type { CodeGraph } from "../lib/domain/code-graph.ts";
import { repositorySnapshotLimits } from "../lib/domain/repository-snapshot.ts";

const graph: CodeGraph = {
  schemaVersion: "1.0",
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
      discoveredFiles: 0,
      analyzedFiles: 0,
      skippedFiles: 0,
      discoveredBytes: 0,
      analyzedBytes: 0,
      truncated: false,
    },
  },
  nodes: [
    { id: "file:c", kind: "file", name: "charlie.ts" },
    { id: "file:a", kind: "file", name: "alpha.ts" },
    { id: "file:b", kind: "file", name: "beta.ts" },
    { id: "symbol:alpha", kind: "symbol", name: "Alpha" },
  ],
  edges: [
    { from: "file:b", to: "file:c", kind: "imports", provenance: "EXTRACTED", evidence: [] },
    { from: "file:a", to: "file:b", kind: "imports", provenance: "EXTRACTED", evidence: [] },
    {
      from: "file:a",
      to: "symbol:alpha",
      kind: "declares",
      provenance: "EXTRACTED",
      evidence: [],
    },
  ],
};

test("query contract applies bounded defaults and rejects excess budgets", () => {
  assert.deepStrictEqual(parseGraphQuery({ type: "node", nodeId: "file:a" }), {
    type: "node",
    nodeId: "file:a",
    budget: { maxCost: 10_000, maxResults: 50, maxTimeMs: 100 },
  });
  assert.throws(
    () => parseGraphQuery({ type: "search", text: "a", budget: { maxCost: 50_001 } }),
    /between 1 and 50000/,
  );
  assert.throws(
    () => parseGraphQuery({ type: "neighbors", nodeId: "file:a", extra: true }),
    /not allowed/,
  );
});

test("search, node, neighbors, and explain are deterministic", () => {
  const search = executeGraphQuery(
    graph,
    parseGraphQuery({ type: "search", text: "alpha", kinds: ["symbol", "file"] }),
  );
  assert.deepStrictEqual(
    search.nodes.map((node) => node.id),
    ["file:a", "symbol:alpha"],
  );
  assert.deepStrictEqual(
    executeGraphQuery(graph, parseGraphQuery({ type: "node", nodeId: "file:b" })).nodes.map(
      (node) => node.id,
    ),
    ["file:b"],
  );
  const neighbors = executeGraphQuery(
    graph,
    parseGraphQuery({ type: "neighbors", nodeId: "file:a", direction: "outgoing" }),
  );
  assert.deepStrictEqual(
    neighbors.edges.map((edge) => edge.to),
    ["file:b", "symbol:alpha"],
  );
  const explain = executeGraphQuery(graph, parseGraphQuery({ type: "explain", nodeId: "file:b" }));
  assert.deepStrictEqual(
    explain.nodes.map((node) => node.id),
    ["file:a", "file:b", "file:c"],
  );
});

test("shortest path is bounded and reports cost and truncation", () => {
  const path = executeGraphQuery(
    graph,
    parseGraphQuery({
      type: "shortestPath",
      from: "file:a",
      to: "file:c",
      direction: "outgoing",
      edgeKinds: ["imports"],
    }),
  );
  assert.deepStrictEqual(path.path, ["file:a", "file:b", "file:c"]);
  assert.ok(path.cost > 0);
  const bounded = executeGraphQuery(
    graph,
    parseGraphQuery({
      type: "shortestPath",
      from: "file:a",
      to: "file:c",
      direction: "outgoing",
      budget: { maxCost: 1 },
    }),
  );
  assert.equal(bounded.path, null);
  assert.equal(bounded.cost, 1);
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.truncationReason, "cost");
});

test("neighbors paginate deterministically and impact traversal handles cycles", () => {
  const first = executeGraphQuery(
    graph,
    parseGraphQuery({
      type: "neighbors",
      nodeId: "file:a",
      direction: "outgoing",
      budget: { maxResults: 1 },
    }),
  );
  assert.deepStrictEqual(
    first.edges.map((edge) => edge.to),
    ["file:b"],
  );
  assert.equal(first.nextCursor, 1);
  assert.equal(first.truncationReason, "results");
  const second = executeGraphQuery(
    graph,
    parseGraphQuery({
      type: "neighbors",
      nodeId: "file:a",
      direction: "outgoing",
      cursor: first.nextCursor,
      budget: { maxResults: 1 },
    }),
  );
  assert.deepStrictEqual(
    second.edges.map((edge) => edge.to),
    ["symbol:alpha"],
  );
  assert.equal(second.nextCursor, null);

  const impact = executeGraphQuery(
    {
      ...graph,
      edges: [
        ...graph.edges,
        { from: "file:c", to: "file:a", kind: "imports", provenance: "EXTRACTED", evidence: [] },
      ],
    },
    parseGraphQuery({
      type: "impact",
      nodeId: "file:a",
      direction: "outgoing",
      edgeKinds: ["imports"],
      maxDepth: 5,
    }),
  );
  assert.deepStrictEqual(
    impact.nodes.map((node) => node.id),
    ["file:a", "file:b", "file:c"],
  );
  assert.equal(impact.truncated, false);
});

test("canonical graph JSON is permutation-stable", () => {
  assert.equal(
    canonicalGraphJson(graph),
    canonicalGraphJson({
      ...graph,
      nodes: [...graph.nodes].reverse(),
      edges: [...graph.edges].reverse(),
    }),
  );
});
