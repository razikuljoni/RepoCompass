import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeCodeGraph } from "../lib/analysis/canonicalize-code-graph.ts";
import { parseCodeGraph } from "../lib/analysis/code-graph-contract.ts";
import type { CodeGraph } from "../lib/domain/code-graph.ts";
import { repositorySnapshotLimits } from "../lib/domain/repository-snapshot.ts";

const graph: CodeGraph = {
  schemaVersion: "1.0",
  snapshot: {
    snapshotId: "snapshot-1",
    provider: "github",
    repositoryId: "github:example/project",
    requestedRef: "main",
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    treeSha: "abcdef0123456789abcdef0123456789abcdef01",
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
    {
      id: "symbol:run",
      kind: "symbol",
      name: "run",
      location: { path: ".\\src\\run.ts", startLine: 3, endLine: 5 },
    },
    { id: "file:src/run.ts", kind: "file", name: "run.ts", location: { path: "src/run.ts" } },
  ],
  edges: [
    {
      from: "file:src/run.ts",
      to: "symbol:run",
      kind: "declares",
      provenance: "EXTRACTED",
      evidence: [{ path: "src\\run.ts", startLine: 3 }],
    },
    {
      from: "file:src/run.ts",
      to: "symbol:run",
      kind: "declares",
      provenance: "EXTRACTED",
      evidence: [
        { path: "./src/run.ts", startLine: 3 },
        { path: "src/run.ts", startLine: 4 },
      ],
    },
  ],
};

test("parses a versioned graph contract", () => {
  assert.deepStrictEqual(parseCodeGraph(graph), graph);
});

test("canonicalizes paths, ordering, duplicate edges, and evidence", () => {
  assert.deepStrictEqual(canonicalizeCodeGraph(graph), {
    ...graph,
    nodes: [
      { id: "file:src/run.ts", kind: "file", name: "run.ts", location: { path: "src/run.ts" } },
      {
        id: "symbol:run",
        kind: "symbol",
        name: "run",
        location: { path: "src/run.ts", startLine: 3, endLine: 5 },
      },
    ],
    edges: [
      {
        from: "file:src/run.ts",
        to: "symbol:run",
        kind: "declares",
        provenance: "EXTRACTED",
        evidence: [
          { path: "src/run.ts", startLine: 3 },
          { path: "src/run.ts", startLine: 4 },
        ],
      },
    ],
  });
});

test("rejects unsupported versions, non-canonical commits, and dangling edges", () => {
  assert.throws(
    () => parseCodeGraph({ ...graph, schemaVersion: "2.0" }),
    /graph\.schemaVersion must be "1\.0"/,
  );
  assert.throws(
    () =>
      parseCodeGraph({
        ...graph,
        snapshot: { ...graph.snapshot, commitSha: "0123456789abcdef" },
      }),
    /snapshot\.commitSha must be a lowercase 40-character hexadecimal GitHub object SHA/,
  );
  assert.throws(
    () =>
      parseCodeGraph({
        ...graph,
        edges: [{ ...graph.edges[0], to: "symbol:missing" }],
      }),
    /edges\[0\]\.to references an unknown node/,
  );
});

test("rejects invalid confidence and source locations", () => {
  assert.throws(
    () =>
      parseCodeGraph({
        ...graph,
        edges: [{ ...graph.edges[0], confidence: 1.1 }],
      }),
    /edges\[0\]\.confidence must be a number between 0 and 1/,
  );
  assert.throws(
    () =>
      parseCodeGraph({
        ...graph,
        nodes: [
          { ...graph.nodes[0], location: { path: "src/run.ts", startLine: 5, endLine: 3 } },
          graph.nodes[1],
        ],
      }),
    /nodes\[0\]\.location\.endLine must be greater than or equal to startLine/,
  );
});
