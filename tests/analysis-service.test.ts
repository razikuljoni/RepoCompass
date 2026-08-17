import assert from "node:assert/strict";
import test from "node:test";
import type { AnalysisQueueMessageV1 } from "../lib/domain/analysis-job.ts";
import { InMemoryArtifactStore } from "../lib/persistence/artifact-store.ts";
import { InMemoryAnalysisStore } from "../lib/persistence/analysis-store.ts";
import type { GitHubClient } from "../lib/providers/github-client.ts";
import { createAnalysisService } from "../lib/runtime/analysis-service.ts";

const commitSha = "a".repeat(40);
const treeSha = "b".repeat(40);
const hash = async (value: string | Uint8Array) => {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
};

test("service resolves snapshot identity before returning and reuses job capability", async () => {
  const analysisStore = new InMemoryAnalysisStore();
  const artifactStore = new InMemoryArtifactStore();
  const messages: AnalysisQueueMessageV1[] = [];
  const github: GitHubClient = {
    resolveRevision: async () => ({ commitSha, treeSha }),
    getTree: async () => [],
    getBlob: async () => {
      throw new Error("not used");
    },
  };
  const pipeline = {
    analysisStore,
    artifactStore,
    github,
    queue: { send: async (message: AnalysisQueueMessageV1) => void messages.push(message) },
    analyzerVersion: "phase-1a.1",
    clock: () => new Date("2026-08-17T00:00:00.000Z"),
    hash,
  };
  const service = createAnalysisService({
    analysisStore,
    artifactStore,
    pipeline,
    capabilitySecret: "test-secret",
  });
  const first = await service.create({ repositoryUrl: "https://github.com/example/project" });
  const reused = await service.create({ repositoryUrl: "https://github.com/example/project" });
  assert.equal(first.snapshot.commitSha, commitSha);
  assert.equal(first.snapshot.treeSha, treeSha);
  assert.equal(first.analysisId, reused.analysisId);
  assert.equal(first.capabilityToken, reused.capabilityToken);
  assert.equal(messages.length, 1);
  assert.equal(Object.hasOwn(first, "idempotencyKey"), false);
});
