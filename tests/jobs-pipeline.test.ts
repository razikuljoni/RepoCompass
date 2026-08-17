import assert from "node:assert/strict";
import test from "node:test";
import {
  createAnalysis,
  processAnalysisMessage,
  type AnalysisQueue,
} from "../lib/jobs/pipeline.ts";
import { InMemoryAnalysisStore } from "../lib/persistence/analysis-store.ts";
import { decodeJson, InMemoryArtifactStore } from "../lib/persistence/artifact-store.ts";
import type { AnalysisQueueMessageV1 } from "../lib/domain/analysis-job.ts";
import type { GitHubClient } from "../lib/providers/github-client.ts";
import { parseAnalysisResult } from "../lib/analysis/analysis-result-contract.ts";

const commitSha = "a".repeat(40);
const treeSha = "b".repeat(40);
const clock = () => new Date("2026-08-17T00:00:00.000Z");
const hash = async (value: string | Uint8Array) => {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const copy = bytes.slice();
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

function fixture(fileCount = 11) {
  const analysisStore = new InMemoryAnalysisStore();
  const artifactStore = new InMemoryArtifactStore();
  const messages: AnalysisQueueMessageV1[] = [];
  const queue: AnalysisQueue = { send: async (message) => void messages.push(message) };
  const blobs: string[] = [];
  const github: GitHubClient = {
    resolveRevision: async () => ({ commitSha, treeSha }),
    getTree: async (_repository, requestedTreeSha) => {
      assert.equal(requestedTreeSha, treeSha);
      return Array.from({ length: fileCount }, (_, index) => {
        const sha = index.toString(16).padStart(40, "0");
        blobs.push(sha);
        return { path: `src/${index}.ts`, sha, mode: "100644", size: 12, kind: "blob" as const };
      });
    },
    getBlob: async (_repository, sha) => {
      assert.ok(blobs.includes(sha));
      return { sha, size: 12, encoding: "utf-8", content: "export {};\n" };
    },
  };
  const dependencies = {
    analysisStore,
    artifactStore,
    github,
    queue,
    analyzerVersion: "phase-2.1",
    clock,
    hash,
  };
  return { dependencies, analysisStore, artifactStore, messages, blobs };
}

async function drain(current: ReturnType<typeof fixture>) {
  while (current.messages.length) {
    await processAnalysisMessage(current.messages.shift()!, current.dependencies);
  }
}

test("creation pins identity and is idempotent before enqueue", async () => {
  const current = fixture(1);
  const first = await createAnalysis(
    { repositoryUrl: "https://github.com/Owner/Repo", ref: "main" },
    current.dependencies,
  );
  const duplicate = await createAnalysis(
    { repositoryUrl: "https://github.com/Owner/Repo", ref: "main" },
    current.dependencies,
  );
  assert.equal(first.snapshot.commitSha, commitSha);
  assert.equal(first.snapshot.treeSha, treeSha);
  assert.equal(first.job.id, duplicate.job.id);
  assert.equal(first.snapshot.id, duplicate.snapshot.id);
  assert.deepStrictEqual(current.messages, [
    { schemaVersion: "1", jobId: first.job.id, expectedStage: "inventory" },
  ]);
});

test("content is fetched in batches of at most ten and stale deliveries are safe", async () => {
  const current = fixture(11);
  const created = await createAnalysis(
    { repositoryUrl: "https://github.com/owner/repo", ref: "main" },
    current.dependencies,
  );
  const inventory = current.messages.shift()!;
  await processAnalysisMessage(inventory, current.dependencies);
  await processAnalysisMessage(inventory, current.dependencies);
  const firstBatch = current.messages.find(
    (entry) => entry.expectedStage === "fetch-content" && entry.cursor === "0",
  )!;
  current.messages.length = 0;
  await processAnalysisMessage(firstBatch, current.dependencies);
  assert.equal(current.blobs.length, 11);
  const continuation = current.messages.shift()!;
  assert.equal(continuation.cursor, "10");
  await processAnalysisMessage(firstBatch, current.dependencies);
  assert.equal(current.blobs.length, 11);
  current.messages.length = 0;
  await processAnalysisMessage(continuation, current.dependencies);
  await drain(current);
  const job = await current.analysisStore.getAnalysisJob(created.job.id);
  assert.equal(job?.status, "succeeded");
  assert.equal(job?.stage, "complete");
  assert.equal(job?.completedUnits, 11);
  assert.equal(job?.totalUnits, 11);
  assert.ok(job?.resultKey);
  const result = decodeJson<Record<string, unknown>>(
    (await current.artifactStore.get(job!.resultKey!))!,
  );
  assert.equal(result.jobId, created.job.id);
  const snapshot = await current.analysisStore.getSnapshot(created.snapshot.id);
  assert.equal(snapshot?.manifestKey, `manifest/${created.snapshot.id}/progress-11.json`);
  assert.equal(snapshot?.fileCount, 11);
  assert.equal(snapshot?.totalBytes, 132);
  assert.match(snapshot?.manifestHash ?? "", /^[a-f0-9]{64}$/);
});

test("successful analysis persists a canonical v2 graph and compatibility model", async () => {
  const current = fixture(2);
  const files = new Map([
    ["src/a.ts", "export function alpha() {}\n"],
    ["src/b.ts", "import { alpha } from './a';\nexport const beta = alpha();\n"],
  ]);
  current.dependencies.github = {
    ...current.dependencies.github,
    getTree: async () =>
      [...files].reverse().map(([path, content], index) => ({
        path,
        sha: (index + 1).toString(16).padStart(40, "0"),
        mode: "100644",
        size: Buffer.byteLength(content),
        kind: "blob" as const,
      })),
    getBlob: async (_repository, sha) => {
      const [path, content] = [...files].reverse()[Number.parseInt(sha, 16) - 1];
      assert.ok(path);
      return { sha, size: Buffer.byteLength(content), encoding: "utf-8", content };
    },
  };
  const created = await createAnalysis(
    { repositoryUrl: "https://github.com/owner/repo", ref: "main" },
    current.dependencies,
  );
  await drain(current);
  const job = await current.analysisStore.getAnalysisJob(created.job.id);
  const result = parseAnalysisResult(
    decodeJson((await current.artifactStore.get(job!.resultKey!))!),
  );
  assert.equal(result.analyzerVersion, "phase-2.1");
  assert.equal(result.graph?.schemaVersion, "2.0");
  assert.deepStrictEqual(result.graph?.snapshot, result.snapshot);
  assert.deepStrictEqual(result.model.sourceFiles, ["src/a.ts", "src/b.ts"]);
  assert.deepStrictEqual(
    result.graph?.nodes
      .filter((node) => node.kind === "file")
      .map((node) => ({ name: node.name, path: node.location?.path })),
    [
      { name: "a.ts", path: "src/a.ts" },
      { name: "b.ts", path: "src/b.ts" },
    ],
  );
  assert.deepStrictEqual(
    result.graph?.nodes
      .filter((node) => node.kind === "symbol")
      .map((node) => ({ name: node.name, evidence: node.location })),
    [
      {
        name: "alpha",
        evidence: {
          path: "src/a.ts",
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: 27,
        },
      },
      {
        name: "beta",
        evidence: {
          path: "src/b.ts",
          startLine: 2,
          startColumn: 14,
          endLine: 2,
          endColumn: 28,
        },
      },
    ],
  );
  const artifact = await current.artifactStore.get(job!.resultKey!);
  await processAnalysisMessage(
    { schemaVersion: "1", jobId: created.job.id, expectedStage: "analyze" },
    current.dependencies,
  );
  assert.deepStrictEqual(await current.artifactStore.get(job!.resultKey!), artifact);
});

test("persisted stage repairs continuation after enqueue failure", async () => {
  const current = fixture(1);
  const created = await createAnalysis(
    { repositoryUrl: "https://github.com/owner/repo", ref: "main" },
    current.dependencies,
  );
  const inventory = current.messages.shift()!;
  current.dependencies.queue = { send: async () => Promise.reject(new Error("queue unavailable")) };
  await assert.rejects(
    processAnalysisMessage(inventory, current.dependencies),
    /queue unavailable/,
  );
  assert.equal(
    (await current.analysisStore.getAnalysisJob(created.job.id))?.stage,
    "fetch-content",
  );
  current.dependencies.queue = {
    send: async (queuedMessage) => void current.messages.push(queuedMessage),
  };
  await processAnalysisMessage(inventory, current.dependencies);
  assert.deepStrictEqual(current.messages, [
    {
      schemaVersion: "1",
      jobId: created.job.id,
      expectedStage: "fetch-content",
      cursor: "0",
    },
  ]);
});

test("progress counts processed eligible files instead of manifest positions", async () => {
  const current = fixture(2);
  current.dependencies.github = {
    ...current.dependencies.github,
    getTree: async () => [
      { path: "large.ts", sha: "1".repeat(40), mode: "100644", size: 120_001, kind: "blob" },
      { path: "small.ts", sha: "2".repeat(40), mode: "100644", size: 12, kind: "blob" },
    ],
    getBlob: async () => ({
      sha: "2".repeat(40),
      size: 12,
      encoding: "utf-8",
      content: "export {};\n",
    }),
  };
  const created = await createAnalysis(
    { repositoryUrl: "https://github.com/owner/repo", ref: "main" },
    current.dependencies,
  );
  await processAnalysisMessage(current.messages.shift()!, current.dependencies);
  await processAnalysisMessage(current.messages.shift()!, current.dependencies);
  const job = await current.analysisStore.getAnalysisJob(created.job.id);
  assert.equal(job?.stage, "analyze");
  assert.equal(job?.completedUnits, 1);
  assert.equal(job?.totalUnits, 1);
});

test("binary and oversized inventory entries are excluded honestly", async () => {
  const current = fixture(2);
  current.dependencies.github = {
    ...current.dependencies.github,
    getTree: async () => [
      { path: "large.ts", sha: "1".repeat(40), mode: "100644", size: 120_001, kind: "blob" },
      { path: "binary.dat", sha: "2".repeat(40), mode: "100644", size: 3, kind: "blob" },
    ],
    getBlob: async () => ({
      sha: "2".repeat(40),
      size: 3,
      encoding: "base64",
      content: "AGE=",
    }),
  };
  const created = await createAnalysis(
    { repositoryUrl: "https://github.com/owner/repo", ref: "main" },
    current.dependencies,
  );
  await drain(current);
  const job = await current.analysisStore.getAnalysisJob(created.job.id);
  const result = decodeJson<{ snapshot: { manifest: Array<{ exclusionReason?: string }> } }>(
    (await current.artifactStore.get(job!.resultKey!))!,
  );
  assert.deepStrictEqual(
    result.snapshot.manifest.map((entry) => entry.exclusionReason),
    ["binary-or-invalid-utf8", "file-size-limit"],
  );
});
