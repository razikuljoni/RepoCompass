import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAnalysisStore } from "../lib/persistence/analysis-store.ts";

const snapshot = {
  id: "snapshot-1",
  repositoryId: "github:owner/repo",
  requestedRef: "main",
  commitSha: "a".repeat(40),
  treeSha: "b".repeat(40),
  manifestKey: "manifest/github:owner/repo/a",
  manifestHash: "c".repeat(64),
  fileCount: 2,
  totalBytes: 10,
  createdAt: "2026-01-01T00:00:00.000Z",
};

test("analysis jobs are idempotent and returned values are safe copies", async () => {
  const store = new InMemoryAnalysisStore();
  const first = await store.createAnalysisJob({
    id: "job-1",
    snapshotId: snapshot.id,
    analyzerVersion: "1",
    idempotencyKey: "request-1",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const duplicate = await store.createAnalysisJob({
    id: "job-2",
    snapshotId: snapshot.id,
    analyzerVersion: "2",
    idempotencyKey: "request-1",
  });

  assert.deepStrictEqual(duplicate, first);
  duplicate.status = "failed";
  assert.equal((await store.getJobByIdempotencyKey("request-1"))?.status, "queued");
  assert.equal(await store.getAnalysisJob("job-2"), null);
});

test("repository snapshots are idempotent by repository and commit", async () => {
  const store = new InMemoryAnalysisStore();
  const first = await store.putSnapshot(snapshot);
  const duplicate = await store.putSnapshot({
    ...snapshot,
    id: "snapshot-2",
    requestedRef: "feature",
  });

  assert.deepStrictEqual(duplicate, first);
  assert.deepStrictEqual(
    await store.getSnapshotByIdentity(snapshot.repositoryId, snapshot.commitSha),
    first,
  );
  assert.equal(await store.getSnapshot("snapshot-2"), null);
});

test("snapshot manifest finalization is immutable and idempotent", async () => {
  const store = new InMemoryAnalysisStore();
  await store.putSnapshot({
    ...snapshot,
    manifestKey: null,
    manifestHash: null,
    fileCount: 0,
    totalBytes: 0,
  });
  const finalization = {
    manifestKey: "manifest/snapshot-1/final.json",
    manifestHash: "d".repeat(64),
    fileCount: 3,
    totalBytes: 42,
  };

  assert.deepStrictEqual(await store.finalizeSnapshotManifest(snapshot.id, finalization), {
    ...snapshot,
    ...finalization,
  });
  assert.deepStrictEqual(await store.finalizeSnapshotManifest(snapshot.id, finalization), {
    ...snapshot,
    ...finalization,
  });
  assert.deepStrictEqual(
    await store.finalizeSnapshotManifest(snapshot.id, {
      manifestKey: "manifest/snapshot-1/replacement.json",
      manifestHash: "e".repeat(64),
      fileCount: 4,
      totalBytes: 100,
    }),
    { ...snapshot, ...finalization },
  );
  assert.equal(await store.finalizeSnapshotManifest("missing", finalization), null);
});

test("compare-and-set rejects stale job stage updates", async () => {
  const store = new InMemoryAnalysisStore();
  await store.createAnalysisJob({
    id: "job-1",
    snapshotId: snapshot.id,
    analyzerVersion: "1",
    idempotencyKey: "request-1",
  });
  const updated = await store.compareAndSetAnalysisJob(
    "job-1",
    { status: "queued", stage: "inventory" },
    {
      status: "running",
      stage: "fetch-content",
      attemptCount: 1,
      startedAt: "2026-01-01T00:00:00.000Z",
    },
  );
  const stale = await store.compareAndSetAnalysisJob(
    "job-1",
    { status: "queued", stage: "inventory" },
    { completedUnits: 1 },
  );

  assert.equal(updated?.stage, "fetch-content");
  assert.equal(stale, null);
  assert.equal((await store.getAnalysisJob("job-1"))?.completedUnits, 0);
});
