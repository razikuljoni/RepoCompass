import assert from "node:assert/strict";
import test from "node:test";
import {
  analysisJobErrorCodes,
  analysisJobStages,
  analysisJobStatuses,
  parseAnalysisJob,
  parseAnalysisJobResultResponse,
  parseAnalysisQueueMessageV1,
  parseCreateAnalysisJobInput,
  parseCreateAnalysisJobRequest,
  type AnalysisJob,
  type AnalysisQueueMessageV1,
} from "../lib/domain/analysis-job.ts";
import { repositorySnapshotLimits } from "../lib/domain/repository-snapshot.ts";

const snapshot = {
  snapshotId: "snapshot-1",
  provider: "github" as const,
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
};

const job: AnalysisJob = {
  jobId: "analysis-1",
  analyzerVersion: "phase-1a.1",
  idempotencyKey: "github:example/project:main:phase-1a.1",
  snapshot,
  status: "running",
  progress: { stage: "fetch-content", completedUnits: 2, totalUnits: 4 },
  createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-17T00:00:01.000Z",
  startedAt: "2026-08-17T00:00:01.000Z",
};

test("parses structured analysis jobs", () => {
  assert.deepStrictEqual(parseAnalysisJob(job), job);
  assert.deepStrictEqual(analysisJobStatuses, [
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
  ]);
  assert.deepStrictEqual(analysisJobStages, ["inventory", "fetch-content", "analyze", "complete"]);
  assert.deepStrictEqual(analysisJobErrorCodes, [
    "invalid_repository_url",
    "invalid_ref",
    "repository_not_found",
    "repository_unavailable",
    "github_rate_limited",
    "inventory_limit_exceeded",
    "content_limit_exceeded",
    "invalid_provider_response",
    "analysis_failed",
    "cancelled",
    "internal_error",
  ]);
});

test("validates progress, failures, terminal timestamps, and unknown fields", () => {
  assert.throws(
    () =>
      parseAnalysisJob({
        ...job,
        progress: { stage: "fetch-content", completedUnits: 5, totalUnits: 4 },
      }),
    /completedUnits must not exceed totalUnits/,
  );
  assert.throws(() => parseAnalysisJob({ ...job, status: "failed" }), /error is required/);
  assert.throws(
    () =>
      parseAnalysisJob({
        ...job,
        status: "failed",
        completedAt: "2026-08-17T00:00:02.000Z",
        error: { code: "github.rate_limited", message: "Try later", retryable: true },
      }),
    /job\.error\.code is not supported/,
  );
  assert.deepStrictEqual(
    parseAnalysisJob({
      ...job,
      status: "failed",
      completedAt: "2026-08-17T00:00:02.000Z",
      error: { code: "github_rate_limited", message: "Try later", retryable: true },
    }).error,
    { code: "github_rate_limited", message: "Try later", retryable: true },
  );
  assert.throws(() => parseAnalysisJob({ ...job, extra: true }), /job\.extra is not allowed/);
});

test("parses only the small queue message v1 shape", () => {
  const message: AnalysisQueueMessageV1 = {
    schemaVersion: "1",
    jobId: job.jobId,
    expectedStage: "fetch-content",
    cursor: "20",
  };
  assert.deepStrictEqual(parseAnalysisQueueMessageV1(message), message);
  assert.throws(
    () => parseAnalysisQueueMessageV1({ ...message, schemaVersion: "2" }),
    /message\.schemaVersion must be "1"/,
  );
  for (const field of ["snapshot", "analyzerVersion", "idempotencyKey"]) {
    assert.throws(
      () => parseAnalysisQueueMessageV1({ ...message, [field]: "not-small" }),
      new RegExp(`message\\.${field} is not allowed`),
    );
  }
  assert.throws(
    () => parseAnalysisQueueMessageV1({ ...message, expectedStage: "complete" }),
    /message\.expectedStage is not supported/,
  );
});

test("separates the public create boundary from internal creation", () => {
  assert.deepStrictEqual(
    parseCreateAnalysisJobRequest({
      repositoryUrl: "https://github.com/Example/Project",
      ref: "main",
    }),
    { repositoryUrl: "https://github.com/Example/Project", ref: "main" },
  );
  assert.deepStrictEqual(
    parseCreateAnalysisJobRequest({ repositoryUrl: "https://github.com/a/b" }),
    {
      repositoryUrl: "https://github.com/a/b",
    },
  );
  assert.throws(
    () =>
      parseCreateAnalysisJobRequest({
        repositoryUrl: "https://github.com/example/project",
        analyzerVersion: job.analyzerVersion,
      }),
    /request\.analyzerVersion is not allowed/,
  );
  assert.deepStrictEqual(
    parseCreateAnalysisJobInput({
      analyzerVersion: job.analyzerVersion,
      idempotencyKey: job.idempotencyKey,
      repositoryId: snapshot.repositoryId,
      requestedRef: snapshot.requestedRef,
    }),
    {
      analyzerVersion: job.analyzerVersion,
      idempotencyKey: job.idempotencyKey,
      repositoryId: snapshot.repositoryId,
      requestedRef: snapshot.requestedRef,
    },
  );
});

test("parses result response contracts", () => {
  assert.deepStrictEqual(
    parseAnalysisJobResultResponse(
      { jobId: job.jobId, status: "succeeded", result: { value: 1 } },
      (value) => value as { value: number },
    ),
    { jobId: job.jobId, status: "succeeded", result: { value: 1 } },
  );
});
