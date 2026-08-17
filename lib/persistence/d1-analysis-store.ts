import type {
  AnalysisJobExpectation,
  AnalysisJobRecord,
  AnalysisJobUpdate,
  AnalysisStore,
  CreateAnalysisJobInput,
  CreateRepositoryInput,
  CreateSnapshotInput,
  RepositoryRecord,
  RepositorySnapshotRecord,
  SnapshotManifestFinalization,
} from "./analysis-store.ts";
import type { AnalysisJobStage, AnalysisJobStatus } from "../domain/analysis-job.ts";

export type D1Result<T = unknown> = {
  success: boolean;
  results?: T[];
  meta?: { changes?: number };
};

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
}

export interface D1Binding {
  prepare(query: string): D1PreparedStatement;
}

type RepositoryRow = {
  id: string;
  provider: "github";
  owner: string;
  name: string;
  canonical_url: string;
  provider_repository_id: string | null;
  default_branch: string | null;
  created_at: string;
  updated_at: string;
};

type SnapshotRow = {
  id: string;
  repository_id: string;
  requested_ref: string;
  commit_sha: string;
  tree_sha: string;
  manifest_key: string | null;
  manifest_hash: string | null;
  file_count: number;
  total_bytes: number;
  created_at: string;
};

type JobRow = {
  id: string;
  snapshot_id: string;
  analyzer_version: string;
  idempotency_key: string;
  status: AnalysisJobStatus;
  stage: AnalysisJobStage;
  cursor: string | null;
  completed_units: number;
  total_units: number;
  attempt_count: number;
  result_key: string | null;
  result_hash: string | null;
  error_code: string | null;
  error_message: string | null;
  error_retryable: number | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
};

function repository(row: RepositoryRow): RepositoryRecord {
  return {
    id: row.id,
    provider: row.provider,
    owner: row.owner,
    name: row.name,
    canonicalUrl: row.canonical_url,
    providerRepositoryId: row.provider_repository_id,
    defaultBranch: row.default_branch,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function snapshot(row: SnapshotRow): RepositorySnapshotRecord {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    requestedRef: row.requested_ref,
    commitSha: row.commit_sha,
    treeSha: row.tree_sha,
    manifestKey: row.manifest_key,
    manifestHash: row.manifest_hash,
    fileCount: row.file_count,
    totalBytes: row.total_bytes,
    createdAt: row.created_at,
  };
}

function job(row: JobRow): AnalysisJobRecord {
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    analyzerVersion: row.analyzer_version,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    stage: row.stage,
    cursor: row.cursor,
    completedUnits: row.completed_units,
    totalUnits: row.total_units,
    attemptCount: row.attempt_count,
    resultKey: row.result_key,
    resultHash: row.result_hash,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    errorRetryable: row.error_retryable === null ? null : row.error_retryable === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export class D1AnalysisStore implements AnalysisStore {
  constructor(private readonly database: D1Binding) {}

  async putRepository(input: CreateRepositoryInput): Promise<RepositoryRecord> {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const updatedAt = input.updatedAt ?? createdAt;
    await this.database
      .prepare(
        "INSERT INTO repositories (id, provider, owner, name, canonical_url, provider_repository_id, default_branch, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
      )
      .bind(
        input.id,
        input.provider,
        input.owner,
        input.name,
        input.canonicalUrl,
        input.providerRepositoryId,
        input.defaultBranch,
        createdAt,
        updatedAt,
      )
      .run();
    return (await this.getRepository(input.id))!;
  }

  async getRepository(id: string): Promise<RepositoryRecord | null> {
    const row = await this.database
      .prepare("SELECT * FROM repositories WHERE id = ?")
      .bind(id)
      .first<RepositoryRow>();
    return row ? repository(row) : null;
  }

  async putSnapshot(input: CreateSnapshotInput): Promise<RepositorySnapshotRecord> {
    await this.database
      .prepare(
        "INSERT INTO repository_snapshots (id, repository_id, requested_ref, commit_sha, tree_sha, manifest_key, manifest_hash, file_count, total_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(repository_id, commit_sha) DO NOTHING",
      )
      .bind(
        input.id,
        input.repositoryId,
        input.requestedRef,
        input.commitSha,
        input.treeSha,
        input.manifestKey,
        input.manifestHash,
        input.fileCount,
        input.totalBytes,
        input.createdAt ?? new Date().toISOString(),
      )
      .run();
    return (await this.getSnapshotByIdentity(input.repositoryId, input.commitSha))!;
  }

  async getSnapshot(id: string): Promise<RepositorySnapshotRecord | null> {
    const row = await this.database
      .prepare("SELECT * FROM repository_snapshots WHERE id = ?")
      .bind(id)
      .first<SnapshotRow>();
    return row ? snapshot(row) : null;
  }

  async getSnapshotByIdentity(
    repositoryId: string,
    commitSha: string,
  ): Promise<RepositorySnapshotRecord | null> {
    const row = await this.database
      .prepare("SELECT * FROM repository_snapshots WHERE repository_id = ? AND commit_sha = ?")
      .bind(repositoryId, commitSha)
      .first<SnapshotRow>();
    return row ? snapshot(row) : null;
  }

  async finalizeSnapshotManifest(
    id: string,
    finalization: SnapshotManifestFinalization,
  ): Promise<RepositorySnapshotRecord | null> {
    await this.database
      .prepare(
        "UPDATE repository_snapshots SET manifest_key = ?, manifest_hash = ?, file_count = ?, total_bytes = ? WHERE id = ? AND manifest_key IS NULL AND manifest_hash IS NULL",
      )
      .bind(
        finalization.manifestKey,
        finalization.manifestHash,
        finalization.fileCount,
        finalization.totalBytes,
        id,
      )
      .run();
    return this.getSnapshot(id);
  }

  async createAnalysisJob(input: CreateAnalysisJobInput): Promise<AnalysisJobRecord> {
    const now = input.createdAt ?? new Date().toISOString();
    await this.database
      .prepare(
        "INSERT INTO analysis_jobs (id, snapshot_id, analyzer_version, idempotency_key, status, stage, completed_units, total_units, attempt_count, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', 'inventory', 0, ?, 0, ?, ?) ON CONFLICT(idempotency_key) DO NOTHING",
      )
      .bind(
        input.id,
        input.snapshotId,
        input.analyzerVersion,
        input.idempotencyKey,
        input.totalUnits ?? 0,
        now,
        now,
      )
      .run();
    return (await this.getJobByIdempotencyKey(input.idempotencyKey))!;
  }

  async getAnalysisJob(id: string): Promise<AnalysisJobRecord | null> {
    const row = await this.database
      .prepare("SELECT * FROM analysis_jobs WHERE id = ?")
      .bind(id)
      .first<JobRow>();
    return row ? job(row) : null;
  }

  async getJobByIdempotencyKey(idempotencyKey: string): Promise<AnalysisJobRecord | null> {
    const row = await this.database
      .prepare("SELECT * FROM analysis_jobs WHERE idempotency_key = ?")
      .bind(idempotencyKey)
      .first<JobRow>();
    return row ? job(row) : null;
  }

  async compareAndSetAnalysisJob(
    id: string,
    expected: AnalysisJobExpectation,
    update: AnalysisJobUpdate,
  ): Promise<AnalysisJobRecord | null> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    const columns: [keyof AnalysisJobUpdate, string][] = [
      ["status", "status"],
      ["stage", "stage"],
      ["cursor", "cursor"],
      ["completedUnits", "completed_units"],
      ["totalUnits", "total_units"],
      ["attemptCount", "attempt_count"],
      ["resultKey", "result_key"],
      ["resultHash", "result_hash"],
      ["startedAt", "started_at"],
      ["finishedAt", "finished_at"],
    ];
    for (const [field, column] of columns) {
      if (update[field] !== undefined) {
        assignments.push(`${column} = ?`);
        values.push(update[field]);
      }
    }
    if (update.error !== undefined) {
      assignments.push("error_code = ?", "error_message = ?", "error_retryable = ?");
      values.push(
        update.error?.code ?? null,
        update.error?.message ?? null,
        update.error === null ? null : Number(update.error.retryable),
      );
    }
    assignments.push("updated_at = ?");
    values.push(update.updatedAt ?? new Date().toISOString(), id, expected.status, expected.stage);
    const cursorCondition =
      expected.cursor === undefined
        ? ""
        : expected.cursor === null
          ? " AND cursor IS NULL"
          : " AND cursor = ?";
    if (typeof expected.cursor === "string") values.push(expected.cursor);
    const result = await this.database
      .prepare(
        `UPDATE analysis_jobs SET ${assignments.join(", ")} WHERE id = ? AND status = ? AND stage = ?${cursorCondition}`,
      )
      .bind(...values)
      .run();
    if (result.meta?.changes === 0) return null;
    const current = await this.getAnalysisJob(id);
    if (!current) return null;
    const changed = current.status !== expected.status || current.stage !== expected.stage;
    return result.meta?.changes === undefined && !changed && Object.keys(update).length === 0
      ? null
      : current;
  }
}
