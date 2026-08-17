import assert from "node:assert/strict";
import test from "node:test";
import {
  analysisResultSchemaVersion,
  parseAnalysisResult,
  type AnalysisResult,
} from "../lib/analysis/analysis-result-contract.ts";
import { repositorySnapshotLimits } from "../lib/domain/repository-snapshot.ts";

const coverage = {
  discoveredFiles: 1,
  analyzedFiles: 1,
  skippedFiles: 0,
  discoveredBytes: 120,
  analyzedBytes: 120,
  truncated: false,
};

const snapshot = {
  snapshotId: "snapshot-1",
  provider: "github" as const,
  repositoryId: "github:example/project",
  requestedRef: "main",
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  treeSha: "abcdef0123456789abcdef0123456789abcdef01",
  manifest: [
    {
      path: "src/app.ts",
      kind: "blob" as const,
      mode: "100644",
      gitObjectSha: "1111111111111111111111111111111111111111",
      size: 120,
      eligibleForAnalysis: true,
    },
  ],
  limits: repositorySnapshotLimits,
  coverage,
};

const model = {
  topDirs: [{ name: "src", count: 1 }],
  extensions: [{ name: "ts", count: 1 }],
  sourceFiles: ["src/app.ts"],
  testFiles: [],
  configFiles: [],
  docs: [],
  workflows: [],
  security: [],
  risks: [],
  recommendations: [],
};

const result: AnalysisResult = {
  schemaVersion: "1.0",
  analyzerVersion: "phase-1a.1",
  jobId: "analysis-1",
  snapshot,
  repository: {
    repositoryId: snapshot.repositoryId,
    provider: "github",
    owner: "example",
    name: "project",
  },
  model,
  coverage,
};

test("parses the actual Phase 1 model result without requiring a graph", () => {
  assert.equal(analysisResultSchemaVersion, "1.0");
  assert.deepStrictEqual(parseAnalysisResult(result), result);
});

test("validates schema, repository, model, and coverage", () => {
  assert.throws(
    () => parseAnalysisResult({ ...result, schemaVersion: "2.0" }),
    /result\.schemaVersion must be "1\.0"/,
  );
  assert.throws(
    () =>
      parseAnalysisResult({
        ...result,
        repository: { ...result.repository, repositoryId: "github:other/project" },
      }),
    /repositoryId must match/,
  );
  assert.throws(
    () => parseAnalysisResult({ ...result, model: { ...model, sourceFiles: "src/app.ts" } }),
    /result\.model\.sourceFiles must be an array/,
  );
  assert.throws(
    () => parseAnalysisResult({ ...result, coverage: { ...coverage, analyzedFiles: 0 } }),
    /result\.coverage must match result\.snapshot\.coverage/,
  );
});

test("accepts an optional matching graph", () => {
  const graph = {
    schemaVersion: "1.0" as const,
    snapshot,
    nodes: [{ id: "file:src/app.ts", kind: "file" as const, name: "app.ts" }],
    edges: [],
  };
  assert.deepStrictEqual(parseAnalysisResult({ ...result, graph }).graph, graph);
});

test("rejects an optional graph from a different snapshot", () => {
  assert.throws(
    () =>
      parseAnalysisResult({
        ...result,
        graph: {
          schemaVersion: "1.0",
          snapshot: { ...snapshot, snapshotId: "snapshot-2" },
          nodes: [],
          edges: [],
        },
      }),
    /result\.graph\.snapshot must match result\.snapshot/,
  );
});
