import assert from "node:assert/strict";
import test from "node:test";
import type { AnalysisQueueMessageV1 } from "../lib/domain/analysis-job.ts";
import type { JobPipelineDependencies } from "../lib/jobs/pipeline.ts";
import { InMemoryAnalysisStore } from "../lib/persistence/analysis-store.ts";
import { InMemoryArtifactStore } from "../lib/persistence/artifact-store.ts";
import { GitHubClientError } from "../lib/providers/github-client.ts";
import {
  createAnalysisQueueConsumer,
  type RuntimeQueueMessage,
} from "../lib/runtime/queue-consumer.ts";

const clock = () => new Date("2026-08-17T00:00:00.000Z");

function delivery(body: unknown) {
  const calls: string[] = [];
  const message: RuntimeQueueMessage = {
    body,
    ack: () => void calls.push("ack"),
    retry: () => void calls.push("retry"),
  };
  return { message, calls };
}

async function fixture(error?: Error) {
  const analysisStore = new InMemoryAnalysisStore();
  await analysisStore.putRepository({
    id: "github:owner/repo",
    provider: "github",
    owner: "owner",
    name: "repo",
    canonicalUrl: "https://github.com/owner/repo",
    providerRepositoryId: null,
    defaultBranch: "main",
    createdAt: clock().toISOString(),
    updatedAt: clock().toISOString(),
  });
  await analysisStore.putSnapshot({
    id: "snapshot",
    repositoryId: "github:owner/repo",
    requestedRef: "main",
    commitSha: "a".repeat(40),
    treeSha: "b".repeat(40),
    manifestKey: null,
    manifestHash: null,
    fileCount: 0,
    totalBytes: 0,
    createdAt: clock().toISOString(),
  });
  const job = await analysisStore.createAnalysisJob({
    id: "job",
    snapshotId: "snapshot",
    analyzerVersion: "phase-1a.1",
    idempotencyKey: "key",
    createdAt: clock().toISOString(),
  });
  const dependencies: JobPipelineDependencies = {
    analysisStore,
    artifactStore: new InMemoryArtifactStore(),
    github: {
      resolveRevision: async () => {
        throw new Error("unused");
      },
      getTree: async () => {
        if (error) throw error;
        return [];
      },
      getBlob: async () => {
        throw new Error("unused");
      },
    },
    queue: { send: async () => undefined },
    analyzerVersion: "phase-1a.1",
    clock,
    hash: async () => "a".repeat(64),
  };
  return { analysisStore, dependencies, job };
}

const body: AnalysisQueueMessageV1 = {
  schemaVersion: "1",
  jobId: "job",
  expectedStage: "inventory",
};

test("acks compact and stale queue messages", async () => {
  const current = await fixture();
  const compact = delivery(JSON.stringify(body));
  await createAnalysisQueueConsumer(current.dependencies)({ messages: [compact.message] });
  assert.deepStrictEqual(compact.calls, ["ack"]);
  const stale = delivery(body);
  await createAnalysisQueueConsumer(current.dependencies)({ messages: [stale.message] });
  assert.deepStrictEqual(stale.calls, ["ack"]);
});

test("retries transient failures and fails non-retryable jobs", async () => {
  const transient = await fixture(new GitHubClientError("network", "Network unavailable"));
  const retry = delivery(body);
  await createAnalysisQueueConsumer(transient.dependencies)({ messages: [retry.message] });
  assert.deepStrictEqual(retry.calls, ["retry"]);
  assert.equal((await transient.analysisStore.getAnalysisJob("job"))?.status, "queued");

  const permanent = await fixture(new GitHubClientError("not_found", "Not found"));
  const failed = delivery(body);
  await createAnalysisQueueConsumer(permanent.dependencies)({ messages: [failed.message] });
  assert.deepStrictEqual(failed.calls, ["ack"]);
  const job = await permanent.analysisStore.getAnalysisJob("job");
  assert.equal(job?.status, "failed");
  assert.equal(job?.errorCode, "repository_not_found");
});

test("acks malformed deliveries", async () => {
  const current = await fixture();
  const malformed = delivery("not-json");
  await createAnalysisQueueConsumer(current.dependencies)({ messages: [malformed.message] });
  assert.deepStrictEqual(malformed.calls, ["ack"]);
});
