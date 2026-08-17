import assert from "node:assert/strict";
import test from "node:test";
import type {
  AnalysisJobRecord,
  RepositorySnapshotRecord,
} from "../lib/persistence/analysis-store.ts";
import { toAnalysisStatusResponse } from "../lib/runtime/analysis-service.ts";

const snapshot: RepositorySnapshotRecord = {
  id: "snapshot_1",
  repositoryId: "github:example/project",
  requestedRef: "main",
  commitSha: "a".repeat(40),
  treeSha: "b".repeat(40),
  manifestKey: "manifest/private.json",
  manifestHash: "c".repeat(64),
  fileCount: 2,
  totalBytes: 10,
  createdAt: "2026-08-17T00:00:00.000Z",
};

const job: AnalysisJobRecord = {
  id: "job_1",
  snapshotId: snapshot.id,
  analyzerVersion: "phase-1a.1",
  idempotencyKey: "private-key",
  status: "failed",
  stage: "analyze",
  cursor: "private-cursor",
  completedUnits: 1,
  totalUnits: 2,
  attemptCount: 3,
  resultKey: "result/private.json",
  resultHash: "d".repeat(64),
  errorCode: "analysis_failed",
  errorMessage: "Analysis failed.",
  errorRetryable: false,
  createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-17T00:01:00.000Z",
  startedAt: "2026-08-17T00:00:01.000Z",
  finishedAt: "2026-08-17T00:01:00.000Z",
};

test("status response exposes only safe job and snapshot identity", () => {
  assert.deepStrictEqual(toAnalysisStatusResponse(job, snapshot), {
    analysisId: "job_1",
    status: "failed",
    stage: "analyze",
    progress: { completedUnits: 1, totalUnits: 2 },
    snapshot: {
      snapshotId: "snapshot_1",
      repositoryId: "github:example/project",
      requestedRef: "main",
      commitSha: "a".repeat(40),
      treeSha: "b".repeat(40),
    },
    error: { code: "analysis_failed", message: "Analysis failed.", retryable: false },
  });
  const serialized = JSON.stringify(toAnalysisStatusResponse(job, snapshot));
  for (const privateValue of ["private-key", "private-cursor", "private.json"]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});
