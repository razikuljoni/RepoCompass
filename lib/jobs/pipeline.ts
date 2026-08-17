import { contentModel } from "../analysis/content-model.ts";
import { extractTypeScriptCodeGraph } from "../analysis/typescript-code-graph-extractor.ts";
import {
  analysisResultSchemaVersion,
  parseAnalysisResult,
  type AnalysisResult,
} from "../analysis/analysis-result-contract.ts";
import type { AnalysisQueueMessageV1, CreateAnalysisJobRequest } from "../domain/analysis-job.ts";
import type { Repo } from "../domain/repository.ts";
import {
  parseRepositorySnapshot,
  repositorySnapshotLimits,
  type RepositoryManifestEntry,
  type RepositorySnapshot,
} from "../domain/repository-snapshot.ts";
import type {
  AnalysisStore,
  AnalysisJobRecord,
  RepositorySnapshotRecord,
} from "../persistence/analysis-store.ts";
import {
  artifactKey,
  decodeJson,
  encodeJson,
  type ArtifactStore,
} from "../persistence/artifact-store.ts";
import type { GitHubClient, GitHubTreeEntry } from "../providers/github-client.ts";
import { parseGitHubRepositoryUrl, type GitHubRepository } from "../providers/repository-url.ts";

export type AnalysisQueue = {
  send(message: AnalysisQueueMessageV1): Promise<void>;
};

export type JobPipelineDependencies = {
  analysisStore: AnalysisStore;
  artifactStore: ArtifactStore;
  github: GitHubClient;
  queue: AnalysisQueue;
  analyzerVersion: string;
  clock: () => Date;
  hash: (value: string | Uint8Array) => Promise<string>;
};

export type CreateAnalysisResult = {
  job: AnalysisJobRecord;
  snapshot: RepositorySnapshotRecord;
};

type StoredManifest = RepositorySnapshot;

const message = (
  jobId: string,
  expectedStage: AnalysisQueueMessageV1["expectedStage"],
  cursor?: string,
): AnalysisQueueMessageV1 => ({
  schemaVersion: "1",
  jobId,
  expectedStage,
  ...(cursor ? { cursor } : {}),
});

const now = (dependencies: JobPipelineDependencies) => dependencies.clock().toISOString();

async function identifier(
  dependencies: JobPipelineDependencies,
  prefix: string,
  identity: string,
): Promise<string> {
  return `${prefix}_${(await dependencies.hash(identity)).slice(0, 32)}`;
}

function repositoryIdentity(repository: GitHubRepository): string {
  return `github:${repository.owner.toLowerCase()}/${repository.repo.toLowerCase()}`;
}

function repositoryFromId(id: string): GitHubRepository {
  const separator = id.indexOf(":");
  const [owner, repo] = id.slice(separator + 1).split("/");
  return { owner, repo };
}

function canonicalUrl(repository: GitHubRepository): string {
  return `https://github.com/${repository.owner}/${repository.repo}`;
}

function initialSnapshot(record: RepositorySnapshotRecord): RepositorySnapshot {
  return {
    snapshotId: record.id,
    provider: "github",
    repositoryId: record.repositoryId,
    requestedRef: record.requestedRef,
    commitSha: record.commitSha,
    treeSha: record.treeSha,
    manifest: [],
    limits: { ...repositorySnapshotLimits },
    coverage: {
      discoveredFiles: 0,
      analyzedFiles: 0,
      skippedFiles: 0,
      discoveredBytes: 0,
      analyzedBytes: 0,
      truncated: false,
    },
  };
}

export async function createAnalysis(
  request: CreateAnalysisJobRequest,
  dependencies: JobPipelineDependencies,
): Promise<CreateAnalysisResult> {
  const repository = parseGitHubRepositoryUrl(request.repositoryUrl);
  const repositoryId = repositoryIdentity(repository);
  const revision = await dependencies.github.resolveRevision(repository, request.ref);
  const requestedRef = request.ref ?? revision.commitSha;
  const createdAt = now(dependencies);
  await dependencies.analysisStore.putRepository({
    id: repositoryId,
    provider: "github",
    owner: repository.owner,
    name: repository.repo,
    canonicalUrl: canonicalUrl(repository),
    providerRepositoryId: null,
    defaultBranch: request.ref ? null : requestedRef,
    createdAt,
    updatedAt: createdAt,
  });
  const snapshotId = await identifier(
    dependencies,
    "snapshot",
    `${repositoryId}\0${revision.commitSha}`,
  );
  const snapshot = await dependencies.analysisStore.putSnapshot({
    id: snapshotId,
    repositoryId,
    requestedRef,
    commitSha: revision.commitSha,
    treeSha: revision.treeSha,
    manifestKey: null,
    manifestHash: null,
    fileCount: 0,
    totalBytes: 0,
    createdAt,
  });
  const idempotencyKey = await dependencies.hash(`${snapshot.id}\0${dependencies.analyzerVersion}`);
  const jobId = await identifier(dependencies, "job", idempotencyKey);
  const [existing, job] = await Promise.all([
    dependencies.analysisStore.getJobByIdempotencyKey(idempotencyKey),
    dependencies.analysisStore.createAnalysisJob({
      id: jobId,
      snapshotId: snapshot.id,
      analyzerVersion: dependencies.analyzerVersion,
      idempotencyKey,
      createdAt,
    }),
  ]);
  if (!existing) await dependencies.queue.send(message(job.id, "inventory"));
  return { job, snapshot };
}

function manifestEntry(
  entry: GitHubTreeEntry,
  eligibleSlots: number,
): RepositoryManifestEntry | null {
  if (entry.kind === "tree") return null;
  const kind = entry.kind;
  const size = entry.size ?? 0;
  let exclusionReason: string | undefined;
  if (kind !== "blob") exclusionReason = kind;
  else if (entry.size === undefined) exclusionReason = "unknown-size";
  else if (size > repositorySnapshotLimits.maxDecodedBytesPerFile)
    exclusionReason = "file-size-limit";
  else if (eligibleSlots <= 0) exclusionReason = "analyzed-file-limit";
  return {
    path: entry.path,
    kind,
    mode: entry.mode,
    gitObjectSha: entry.sha,
    size,
    eligibleForAnalysis: exclusionReason === undefined,
    ...(exclusionReason ? { exclusionReason } : {}),
  };
}

async function inventory(
  job: AnalysisJobRecord,
  snapshotRecord: RepositorySnapshotRecord,
  dependencies: JobPipelineDependencies,
): Promise<void> {
  const repository = repositoryFromId(snapshotRecord.repositoryId);
  const tree = [...(await dependencies.github.getTree(repository, snapshotRecord.treeSha))].sort(
    (a, b) => a.path.localeCompare(b.path),
  );
  const fileEntries = tree.filter((entry) => entry.kind !== "tree");
  const bounded = fileEntries.slice(0, repositorySnapshotLimits.maxInventoryEntries);
  let slots = repositorySnapshotLimits.maxAnalyzedFiles;
  const manifest = bounded.map((entry) => {
    const result = manifestEntry(entry, slots)!;
    if (result.eligibleForAnalysis) slots -= 1;
    return result;
  });
  const eligible = manifest.filter((entry) => entry.eligibleForAnalysis);
  const snapshot: RepositorySnapshot = parseRepositorySnapshot({
    ...initialSnapshot(snapshotRecord),
    manifest,
    coverage: {
      discoveredFiles: manifest.length,
      analyzedFiles: 0,
      skippedFiles: manifest.length - eligible.length,
      discoveredBytes: manifest.reduce((total, entry) => total + entry.size, 0),
      analyzedBytes: 0,
      truncated: fileEntries.length > manifest.length,
    },
  });
  const key = artifactKey("manifest", `${snapshotRecord.id}/inventory.json`);
  await dependencies.artifactStore.put(key, encodeJson(snapshot));
  const updated = await dependencies.analysisStore.compareAndSetAnalysisJob(
    job.id,
    { status: job.status, stage: "inventory", cursor: job.cursor },
    {
      status: "running",
      stage: "fetch-content",
      cursor: "0",
      totalUnits: eligible.length,
      attemptCount: job.attemptCount + 1,
      startedAt: job.startedAt ?? now(dependencies),
      updatedAt: now(dependencies),
    },
  );
  if (!updated) {
    const current = await dependencies.analysisStore.getAnalysisJob(job.id);
    if (current) await repairContinuation(current, dependencies);
    return;
  }
  await dependencies.queue.send(message(job.id, "fetch-content", "0"));
}

function decodeBlob(content: string, encoding: "base64" | "utf-8"): Uint8Array {
  if (encoding === "utf-8") return new TextEncoder().encode(content);
  const compact = content.replace(/\s/g, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact))
    throw new TypeError("Invalid base64 blob content");
  return Uint8Array.from(atob(compact), (character) => character.charCodeAt(0));
}

function textContent(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const controls = Array.from(text).filter(
      (character) =>
        character < " " && character !== "\n" && character !== "\r" && character !== "\t",
    ).length;
    return controls > Math.max(1, text.length / 100) ? null : text;
  } catch {
    return null;
  }
}

async function loadManifest(
  snapshot: RepositorySnapshotRecord,
  cursor: string | null,
  artifacts: ArtifactStore,
): Promise<StoredManifest> {
  const suffix = cursor && cursor !== "0" ? `progress-${cursor}.json` : "inventory.json";
  const artifact = await artifacts.get(artifactKey("manifest", `${snapshot.id}/${suffix}`));
  if (!artifact) throw new Error("Manifest artifact is missing");
  return parseRepositorySnapshot(decodeJson(artifact));
}

async function fetchContent(
  job: AnalysisJobRecord,
  snapshotRecord: RepositorySnapshotRecord,
  dependencies: JobPipelineDependencies,
): Promise<void> {
  const snapshot = await loadManifest(snapshotRecord, job.cursor, dependencies.artifactStore);
  const cursor = Number(job.cursor ?? "0");
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > snapshot.manifest.length)
    throw new TypeError("Invalid content cursor");
  const batch = snapshot.manifest
    .slice(cursor)
    .filter((entry) => entry.eligibleForAnalysis)
    .slice(0, repositorySnapshotLimits.contentFetchBatchSize);
  const repository = repositoryFromId(snapshot.repositoryId);
  const blobs = await Promise.all(
    batch.map((entry) => dependencies.github.getBlob(repository, entry.gitObjectSha)),
  );
  let analyzedBytes = snapshot.coverage.analyzedBytes;
  const accepted: Array<{
    entry: RepositoryManifestEntry;
    key: string;
    bytes: Uint8Array;
  }> = [];
  batch.forEach((selected, index) => {
    const entry = snapshot.manifest.find((candidate) => candidate.path === selected.path)!;
    const blob = blobs[index];
    if (blob.sha !== entry.gitObjectSha || blob.size !== entry.size) {
      entry.eligibleForAnalysis = false;
      entry.exclusionReason = "provider-identity-mismatch";
      return;
    }
    const bytes = decodeBlob(blob.content, blob.encoding);
    const text = textContent(bytes);
    if (bytes.byteLength > repositorySnapshotLimits.maxDecodedBytesPerFile) {
      entry.eligibleForAnalysis = false;
      entry.exclusionReason = "file-size-limit";
    } else if (text === null) {
      entry.eligibleForAnalysis = false;
      entry.exclusionReason = "binary-or-invalid-utf8";
    } else if (analyzedBytes + bytes.byteLength > repositorySnapshotLimits.maxDecodedTotalBytes) {
      entry.eligibleForAnalysis = false;
      entry.exclusionReason = "total-content-limit";
      snapshot.coverage.truncated = true;
    } else {
      const key = artifactKey("blob", `${snapshot.snapshotId}/${entry.gitObjectSha}`);
      accepted.push({ entry, key, bytes });
      analyzedBytes += bytes.byteLength;
    }
  });
  const stored = await Promise.all(
    accepted.map(({ key, bytes }) => dependencies.artifactStore.put(key, bytes)),
  );
  accepted.forEach(({ entry, key }, index) => {
    entry.contentKey = key;
    entry.contentSha256 = stored[index].hash;
  });
  const lastBatchEntry = batch.at(-1);
  const nextCursor = lastBatchEntry
    ? snapshot.manifest.findIndex((entry) => entry.path === lastBatchEntry.path) + 1
    : snapshot.manifest.length;
  snapshot.coverage.analyzedFiles = snapshot.manifest.filter((entry) => entry.contentKey).length;
  snapshot.coverage.skippedFiles = snapshot.manifest.length - snapshot.coverage.analyzedFiles;
  snapshot.coverage.analyzedBytes = analyzedBytes;
  const nextKey = artifactKey("manifest", `${snapshot.snapshotId}/progress-${nextCursor}.json`);
  const manifestArtifact = await dependencies.artifactStore.put(
    nextKey,
    encodeJson(parseRepositorySnapshot(snapshot)),
  );
  const complete = !snapshot.manifest.slice(nextCursor).some((entry) => entry.eligibleForAnalysis);
  if (complete) {
    await dependencies.analysisStore.finalizeSnapshotManifest(snapshot.snapshotId, {
      manifestKey: nextKey,
      manifestHash: manifestArtifact.hash,
      fileCount: snapshot.coverage.discoveredFiles,
      totalBytes: snapshot.coverage.discoveredBytes,
    });
  }
  const updated = await dependencies.analysisStore.compareAndSetAnalysisJob(
    job.id,
    { status: "running", stage: "fetch-content", cursor: job.cursor },
    {
      stage: complete ? "analyze" : "fetch-content",
      cursor: String(nextCursor),
      completedUnits: Math.min(job.totalUnits, job.completedUnits + batch.length),
      attemptCount: job.attemptCount + 1,
      updatedAt: now(dependencies),
    },
  );
  if (!updated) {
    const current = await dependencies.analysisStore.getAnalysisJob(job.id);
    if (current) await repairContinuation(current, dependencies);
    return;
  }
  await dependencies.queue.send(
    message(
      job.id,
      complete ? "analyze" : "fetch-content",
      complete ? undefined : String(nextCursor),
    ),
  );
}

async function analyze(
  job: AnalysisJobRecord,
  snapshotRecord: RepositorySnapshotRecord,
  dependencies: JobPipelineDependencies,
): Promise<void> {
  const snapshot = await loadManifest(snapshotRecord, job.cursor, dependencies.artifactStore);
  const repositoryRecord = await dependencies.analysisStore.getRepository(snapshot.repositoryId);
  if (!repositoryRecord) throw new Error("Repository record is missing");
  const contentEntries = snapshot.manifest.filter(
    (entry): entry is RepositoryManifestEntry & { contentKey: string; contentSha256: string } =>
      Boolean(entry.contentKey && entry.contentSha256),
  );
  const contentArtifacts = await Promise.all(
    contentEntries.map((entry) => dependencies.artifactStore.get(entry.contentKey)),
  );
  const indexedFiles = contentEntries.map((entry, index) => {
    const artifact = contentArtifacts[index];
    if (!artifact || artifact.hash !== entry.contentSha256)
      throw new Error("Content artifact is missing");
    return {
      path: entry.path,
      size: artifact.bytes.byteLength,
      content: new TextDecoder().decode(artifact.bytes),
    };
  });
  const repo: Repo = {
    owner: repositoryRecord.owner,
    name: repositoryRecord.name,
    provider: "github",
    branch: snapshot.requestedRef,
    files: snapshot.coverage.discoveredFiles,
    ignored: snapshot.coverage.skippedFiles,
    bytes: snapshot.coverage.discoveredBytes,
    languages: [],
    sampleFiles: snapshot.manifest.map((entry) => entry.path),
    indexedFiles,
    source: "remote",
  };
  const result: AnalysisResult = parseAnalysisResult({
    schemaVersion: analysisResultSchemaVersion,
    analyzerVersion: job.analyzerVersion,
    jobId: job.id,
    snapshot,
    repository: {
      repositoryId: snapshot.repositoryId,
      provider: "github",
      owner: repositoryRecord.owner,
      name: repositoryRecord.name,
    },
    model: contentModel(repo),
    coverage: snapshot.coverage,
    graph: extractTypeScriptCodeGraph({ snapshot, files: indexedFiles }),
  });
  const key = artifactKey("result", `${job.id}.json`);
  const artifact = await dependencies.artifactStore.put(key, encodeJson(result));
  parseAnalysisResult(decodeJson(artifact));
  await dependencies.analysisStore.compareAndSetAnalysisJob(
    job.id,
    { status: "running", stage: "analyze", cursor: job.cursor },
    {
      status: "succeeded",
      stage: "complete",
      completedUnits: job.totalUnits,
      resultKey: key,
      resultHash: artifact.hash,
      attemptCount: job.attemptCount + 1,
      finishedAt: now(dependencies),
      updatedAt: now(dependencies),
    },
  );
}

async function repairContinuation(job: AnalysisJobRecord, dependencies: JobPipelineDependencies) {
  if (job.status === "queued" && job.stage === "inventory")
    await dependencies.queue.send(message(job.id, "inventory"));
  else if (job.status === "running" && job.stage === "fetch-content")
    await dependencies.queue.send(message(job.id, "fetch-content", job.cursor ?? "0"));
  else if (job.status === "running" && job.stage === "analyze")
    await dependencies.queue.send(message(job.id, "analyze"));
}

export async function processAnalysisMessage(
  queueMessage: AnalysisQueueMessageV1,
  dependencies: JobPipelineDependencies,
): Promise<void> {
  const job = await dependencies.analysisStore.getAnalysisJob(queueMessage.jobId);
  if (!job || job.status === "succeeded" || job.status === "failed" || job.status === "cancelled")
    return;
  if (
    job.stage !== queueMessage.expectedStage ||
    (queueMessage.cursor !== undefined && job.cursor !== queueMessage.cursor)
  ) {
    await repairContinuation(job, dependencies);
    return;
  }
  const snapshot = await dependencies.analysisStore.getSnapshot(job.snapshotId);
  if (!snapshot) throw new Error("Snapshot record is missing");
  if (job.stage === "inventory") await inventory(job, snapshot, dependencies);
  else if (job.stage === "fetch-content") await fetchContent(job, snapshot, dependencies);
  else if (job.stage === "analyze") await analyze(job, snapshot, dependencies);
}
