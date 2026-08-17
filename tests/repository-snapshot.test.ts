import assert from "node:assert/strict";
import test from "node:test";
import {
  parseGitHubCommitSha,
  parseRepositorySnapshot,
  repositorySnapshotLimits,
  repositorySnapshotsEqual,
  type RepositorySnapshot,
} from "../lib/domain/repository-snapshot.ts";

const snapshot: RepositorySnapshot = {
  snapshotId: "snapshot-1",
  provider: "github",
  repositoryId: "github:example/project",
  requestedRef: "main",
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  treeSha: "abcdef0123456789abcdef0123456789abcdef01",
  manifest: [
    {
      path: "src/app.ts",
      kind: "blob",
      mode: "100644",
      gitObjectSha: "1111111111111111111111111111111111111111",
      size: 120,
      eligibleForAnalysis: true,
      contentKey: "snapshots/snapshot-1/src/app.ts",
      contentSha256: "2".repeat(64),
    },
    {
      path: "vendor",
      kind: "submodule",
      mode: "160000",
      gitObjectSha: "3333333333333333333333333333333333333333",
      size: 0,
      eligibleForAnalysis: false,
      exclusionReason: "submodule",
    },
  ],
  limits: repositorySnapshotLimits,
  coverage: {
    discoveredFiles: 2,
    analyzedFiles: 1,
    skippedFiles: 1,
    discoveredBytes: 120,
    analyzedBytes: 120,
    truncated: false,
  },
};

test("parses the bounded immutable GitHub repository snapshot", () => {
  assert.deepStrictEqual(parseRepositorySnapshot(snapshot), snapshot);
  assert.equal(parseGitHubCommitSha(snapshot.commitSha, "commitSha"), snapshot.commitSha);
  assert.deepStrictEqual(repositorySnapshotLimits, {
    maxInventoryEntries: 10_000,
    maxAnalyzedFiles: 100,
    maxDecodedBytesPerFile: 120_000,
    maxDecodedTotalBytes: 10_000_000,
    contentFetchBatchSize: 10,
  });
});

test("requires canonical lowercase repository and object identities", () => {
  for (const repositoryId of [
    "example/project",
    "github:Example/project",
    "github:example/Project",
  ]) {
    assert.throws(
      () => parseRepositorySnapshot({ ...snapshot, repositoryId }),
      /canonical lowercase github:owner\/repo format/,
    );
  }
  for (const commitSha of [
    "0123456789abcdef",
    "0123456789ABCDEF0123456789ABCDEF01234567",
    "g123456789abcdef0123456789abcdef01234567",
  ]) {
    assert.throws(
      () => parseRepositorySnapshot({ ...snapshot, commitSha }),
      /snapshot\.commitSha must be a lowercase 40-character hexadecimal GitHub object SHA/,
    );
  }
});

test("validates manifest paths, kinds, modes, eligibility, and metadata", () => {
  assert.throws(
    () =>
      parseRepositorySnapshot({
        ...snapshot,
        manifest: [{ ...snapshot.manifest[0], path: "../secret" }],
      }),
    /safe repository-relative path/,
  );
  assert.throws(
    () =>
      parseRepositorySnapshot({
        ...snapshot,
        manifest: [snapshot.manifest[0], snapshot.manifest[0]],
      }),
    /duplicate paths/,
  );
  assert.throws(
    () =>
      parseRepositorySnapshot({
        ...snapshot,
        manifest: [
          {
            ...snapshot.manifest[0],
            kind: "symlink",
            mode: "100644",
            eligibleForAnalysis: false,
            contentKey: undefined,
            contentSha256: undefined,
          },
        ],
      }),
    /does not match entry kind/,
  );
  assert.throws(
    () =>
      parseRepositorySnapshot({
        ...snapshot,
        manifest: [{ ...snapshot.manifest[1], eligibleForAnalysis: true }],
      }),
    /must be false for submodule/,
  );
  assert.throws(
    () =>
      parseRepositorySnapshot({
        ...snapshot,
        manifest: [{ ...snapshot.manifest[0], blobSha: "1".repeat(40) }],
      }),
    /blobSha is not allowed/,
  );
});

test("requires exact limits and bounded coverage", () => {
  assert.throws(
    () =>
      parseRepositorySnapshot({
        ...snapshot,
        limits: {
          ...snapshot.limits,
          maxDecodedBytesPerFile: snapshot.limits.maxDecodedBytesPerFile + 1,
        },
      }),
    /limits\.maxDecodedBytesPerFile must be 120000/,
  );
  assert.throws(
    () =>
      parseRepositorySnapshot({
        ...snapshot,
        coverage: { ...snapshot.coverage, analyzedFiles: 101 },
      }),
    /file counts are inconsistent|analysis limit/,
  );
  assert.throws(
    () => parseRepositorySnapshot({ ...snapshot, unexpected: true }),
    /snapshot\.unexpected is not allowed/,
  );
});

test("compares stable snapshot identity", () => {
  assert.equal(repositorySnapshotsEqual(snapshot, { ...snapshot }), true);
  assert.equal(
    repositorySnapshotsEqual(snapshot, { ...snapshot, snapshotId: "snapshot-2" }),
    false,
  );
});
