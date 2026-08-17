import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeCodeGraph } from "../lib/analysis/canonicalize-code-graph.ts";
import { parseCodeGraph } from "../lib/analysis/code-graph-contract.ts";
import { codeGraphLimits, type CodeGraph, type CodeGraphV2 } from "../lib/domain/code-graph.ts";
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
    () => parseCodeGraph({ ...graph, schemaVersion: "3.0" }),
    /graph\.schemaVersion must be "1\.0" or "2\.0"/,
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

const v2Snapshot: CodeGraphV2["snapshot"] = {
  ...graph.snapshot,
  manifest: [
    {
      path: "src/run.ts",
      kind: "blob",
      mode: "100644",
      gitObjectSha: "1111111111111111111111111111111111111111",
      size: 100,
      eligibleForAnalysis: true,
    },
    {
      path: "src/types.ts",
      kind: "blob",
      mode: "100644",
      gitObjectSha: "2222222222222222222222222222222222222222",
      size: 50,
      eligibleForAnalysis: true,
    },
  ],
  coverage: {
    discoveredFiles: 2,
    analyzedFiles: 2,
    skippedFiles: 0,
    discoveredBytes: 150,
    analyzedBytes: 150,
    truncated: false,
  },
};

const graphV2: CodeGraphV2 = {
  schemaVersion: "2.0",
  snapshot: v2Snapshot,
  limits: codeGraphLimits,
  coverage: { analyzedFiles: 2, totalFiles: 2, percentage: 1, truncated: false },
  metrics: { nodeCount: 5, edgeCount: 2, diagnosticCount: 1 },
  diagnostics: [
    {
      code: "IMPORT_AMBIGUOUS",
      severity: "warning",
      message: "Import has multiple candidates",
      edgeId: "edge:2",
      location: { path: "src/run.ts", startLine: 1, startColumn: 1 },
    },
  ],
  nodes: [
    {
      id: "symbol:run",
      kind: "symbol",
      name: "run",
      location: { path: "src/run.ts", startLine: 2, startColumn: 1, endLine: 4, endColumn: 2 },
      metadata: {
        symbolKind: "function",
        qualifiedName: "run",
        signature: "run(): void",
        visibility: "public",
        exported: true,
        async: false,
      },
    },
    {
      id: "file:src/types.ts",
      kind: "file",
      name: "types.ts",
      location: { path: "src/types.ts" },
      metadata: { path: "src/types.ts", language: "TypeScript", sizeBytes: 50 },
    },
    {
      id: "route:get-users",
      kind: "route",
      name: "GET /users",
      metadata: { path: "/users", methods: ["POST", "GET"], framework: "Next.js" },
    },
    {
      id: "schema:user",
      kind: "schema",
      name: "User",
      location: { path: "src/types.ts", startLine: 1 },
      metadata: { schemaKind: "interface", qualifiedName: "User", fields: ["name", "id"] },
    },
    {
      id: "file:src/run.ts",
      kind: "file",
      name: "run.ts",
      location: { path: "src/run.ts" },
      metadata: { path: "src/run.ts", language: "TypeScript", sizeBytes: 100, module: "app" },
    },
  ],
  edges: [
    {
      id: "edge:2",
      from: "file:src/run.ts",
      to: "file:src/types.ts",
      kind: "imports",
      provenance: "AMBIGUOUS",
      confidence: 0.5,
      metadata: {
        mode: "type",
        specifier: "./types",
        typeOnly: true,
        resolution: "ambiguous",
        candidates: ["src/types.ts", "src/types/index.ts"],
      },
      evidence: [
        { path: "src/run.ts", startLine: 1, startColumn: 10 },
        { path: "src/run.ts", startLine: 1, startColumn: 1 },
      ],
    },
    {
      id: "edge:1",
      from: "file:src/run.ts",
      to: "symbol:run",
      kind: "declares",
      provenance: "EXTRACTED",
      confidence: 1,
      evidence: [{ path: "src/run.ts", startLine: 2, startColumn: 1 }],
    },
  ],
};

test("parses strict rich CodeGraph v2 metadata", () => {
  assert.deepStrictEqual(parseCodeGraph(graphV2), graphV2);
});

test("rejects v2 unknown keys, unsafe or absent paths, bad semantics, limits, and endpoints", () => {
  assert.throws(() => parseCodeGraph({ ...graphV2, extra: true }), /graph\.extra is not allowed/);
  assert.throws(
    () =>
      parseCodeGraph({
        ...graphV2,
        nodes: graphV2.nodes.map((item) =>
          item.kind === "file" && item.id === "file:src/run.ts"
            ? { ...item, metadata: { ...item.metadata, path: "../run.ts" } }
            : item,
        ),
      }),
    /safe repository-relative path/,
  );
  assert.throws(
    () =>
      parseCodeGraph({
        ...graphV2,
        nodes: graphV2.nodes.map((item) =>
          item.kind === "file" && item.id === "file:src/run.ts"
            ? { ...item, metadata: { ...item.metadata, path: "src/missing.ts" } }
            : item,
        ),
      }),
    /not in snapshot\.manifest/,
  );
  assert.throws(
    () =>
      parseCodeGraph({
        ...graphV2,
        edges: graphV2.edges.map((item) =>
          item.id === "edge:2" ? { ...item, provenance: "INFERRED", confidence: 1 } : item,
        ),
      }),
    /confidence must be less than 1/,
  );
  assert.throws(
    () => parseCodeGraph({ ...graphV2, limits: { ...codeGraphLimits, maxNodes: 1 } }),
    /graph\.limits\.maxNodes must be/,
  );
  assert.throws(
    () =>
      parseCodeGraph({
        ...graphV2,
        edges: graphV2.edges.map((item) =>
          item.id === "edge:1" ? { ...item, to: "symbol:missing" } : item,
        ),
      }),
    /references an unknown node/,
  );
});

test("canonicalizes v2 without mutation and is idempotent and permutation-stable", () => {
  const duplicate = {
    ...graphV2.edges[0],
    id: "edge:3",
    evidence: [graphV2.edges[0].evidence[0], { path: "src/run.ts", startLine: 1, startColumn: 5 }],
  };
  const input: CodeGraphV2 = {
    ...graphV2,
    metrics: { ...graphV2.metrics, edgeCount: 3 },
    edges: [...graphV2.edges, duplicate],
    diagnostics: [...graphV2.diagnostics],
    nodes: [...graphV2.nodes],
  };
  const before = structuredClone(input);
  const canonical = canonicalizeCodeGraph(input);
  assert.deepStrictEqual(input, before);
  assert.deepStrictEqual(canonicalizeCodeGraph(canonical), canonical);
  assert.equal(canonical.schemaVersion, "2.0");
  assert.equal(canonical.edges.length, 2);
  assert.deepStrictEqual(
    canonicalizeCodeGraph({
      ...input,
      nodes: [...input.nodes].reverse(),
      edges: [...input.edges].reverse(),
      diagnostics: [...input.diagnostics].reverse(),
      snapshot: { ...input.snapshot, manifest: [...input.snapshot.manifest].reverse() },
    }),
    canonical,
  );
});
