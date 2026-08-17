import type {
  AnalysisJobError,
  AnalysisJobStage,
  AnalysisJobStatus,
} from "../domain/analysis-job.ts";

export type RepositoryRecord = {
  id: string;
  provider: "github";
  owner: string;
  name: string;
  canonicalUrl: string;
  providerRepositoryId: string | null;
  defaultBranch: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RepositorySnapshotRecord = {
  id: string;
  repositoryId: string;
  requestedRef: string;
  commitSha: string;
  treeSha: string;
  manifestKey: string | null;
  manifestHash: string | null;
  fileCount: number;
  totalBytes: number;
  createdAt: string;
};

export type AnalysisJobRecord = {
  id: string;
  snapshotId: string;
  analyzerVersion: string;
  idempotencyKey: string;
  status: AnalysisJobStatus;
  stage: AnalysisJobStage;
  cursor: string | null;
  completedUnits: number;
  totalUnits: number;
  attemptCount: number;
  resultKey: string | null;
  resultHash: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  errorRetryable: boolean | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type CreateRepositoryInput = Omit<RepositoryRecord, "createdAt" | "updatedAt"> & {
  createdAt?: string;
  updatedAt?: string;
};

export type CreateSnapshotInput = Omit<RepositorySnapshotRecord, "createdAt"> & {
  createdAt?: string;
};

export type CreateAnalysisJobInput = Pick<
  AnalysisJobRecord,
  "id" | "snapshotId" | "analyzerVersion" | "idempotencyKey"
> & {
  createdAt?: string;
  totalUnits?: number;
};

export type SnapshotManifestFinalization = {
  manifestKey: string;
  manifestHash: string;
  fileCount: number;
  totalBytes: number;
};

export type AnalysisJobExpectation = Pick<AnalysisJobRecord, "status" | "stage"> & {
  cursor?: string | null;
};

export type AnalysisJobUpdate = Partial<
  Pick<
    AnalysisJobRecord,
    | "status"
    | "stage"
    | "cursor"
    | "completedUnits"
    | "totalUnits"
    | "attemptCount"
    | "resultKey"
    | "resultHash"
    | "startedAt"
    | "finishedAt"
  >
> & {
  error?: AnalysisJobError | null;
  updatedAt?: string;
};

export interface AnalysisStore {
  putRepository(input: CreateRepositoryInput): Promise<RepositoryRecord>;
  getRepository(id: string): Promise<RepositoryRecord | null>;
  putSnapshot(input: CreateSnapshotInput): Promise<RepositorySnapshotRecord>;
  getSnapshot(id: string): Promise<RepositorySnapshotRecord | null>;
  getSnapshotByIdentity(
    repositoryId: string,
    commitSha: string,
  ): Promise<RepositorySnapshotRecord | null>;
  finalizeSnapshotManifest(
    id: string,
    finalization: SnapshotManifestFinalization,
  ): Promise<RepositorySnapshotRecord | null>;
  createAnalysisJob(input: CreateAnalysisJobInput): Promise<AnalysisJobRecord>;
  getAnalysisJob(id: string): Promise<AnalysisJobRecord | null>;
  getJobByIdempotencyKey(idempotencyKey: string): Promise<AnalysisJobRecord | null>;
  compareAndSetAnalysisJob(
    id: string,
    expected: AnalysisJobExpectation,
    update: AnalysisJobUpdate,
  ): Promise<AnalysisJobRecord | null>;
}

function copy<T extends object>(value: T): T {
  return { ...value };
}

function snapshotIdentity(repositoryId: string, commitSha: string): string {
  return `${repositoryId}\u0000${commitSha}`;
}

export class InMemoryAnalysisStore implements AnalysisStore {
  private readonly repositories = new Map<string, RepositoryRecord>();
  private readonly snapshots = new Map<string, RepositorySnapshotRecord>();
  private readonly snapshotIdentities = new Map<string, string>();
  private readonly jobs = new Map<string, AnalysisJobRecord>();
  private readonly jobIdempotencyKeys = new Map<string, string>();

  async putRepository(input: CreateRepositoryInput): Promise<RepositoryRecord> {
    const existing = this.repositories.get(input.id);
    if (existing) return copy(existing);
    const createdAt = input.createdAt ?? new Date().toISOString();
    const repository: RepositoryRecord = {
      ...input,
      createdAt,
      updatedAt: input.updatedAt ?? createdAt,
    };
    this.repositories.set(repository.id, repository);
    return copy(repository);
  }

  async getRepository(id: string): Promise<RepositoryRecord | null> {
    const repository = this.repositories.get(id);
    return repository ? copy(repository) : null;
  }

  async putSnapshot(input: CreateSnapshotInput): Promise<RepositorySnapshotRecord> {
    const identity = snapshotIdentity(input.repositoryId, input.commitSha);
    const existingId = this.snapshotIdentities.get(identity);
    if (existingId) return copy(this.snapshots.get(existingId)!);
    const existing = this.snapshots.get(input.id);
    if (existing) return copy(existing);
    const snapshot: RepositorySnapshotRecord = {
      ...input,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.snapshots.set(snapshot.id, snapshot);
    this.snapshotIdentities.set(identity, snapshot.id);
    return copy(snapshot);
  }

  async getSnapshot(id: string): Promise<RepositorySnapshotRecord | null> {
    const snapshot = this.snapshots.get(id);
    return snapshot ? copy(snapshot) : null;
  }

  async getSnapshotByIdentity(
    repositoryId: string,
    commitSha: string,
  ): Promise<RepositorySnapshotRecord | null> {
    const id = this.snapshotIdentities.get(snapshotIdentity(repositoryId, commitSha));
    return id ? copy(this.snapshots.get(id)!) : null;
  }

  async finalizeSnapshotManifest(
    id: string,
    finalization: SnapshotManifestFinalization,
  ): Promise<RepositorySnapshotRecord | null> {
    const current = this.snapshots.get(id);
    if (!current) return null;
    if (current.manifestKey === null) {
      const finalized = { ...current, ...finalization };
      this.snapshots.set(id, finalized);
      return copy(finalized);
    }
    return copy(current);
  }

  async createAnalysisJob(input: CreateAnalysisJobInput): Promise<AnalysisJobRecord> {
    const existingId = this.jobIdempotencyKeys.get(input.idempotencyKey);
    if (existingId) return copy(this.jobs.get(existingId)!);
    const existing = this.jobs.get(input.id);
    if (existing) return copy(existing);
    const now = input.createdAt ?? new Date().toISOString();
    const job: AnalysisJobRecord = {
      id: input.id,
      snapshotId: input.snapshotId,
      analyzerVersion: input.analyzerVersion,
      idempotencyKey: input.idempotencyKey,
      status: "queued",
      stage: "inventory",
      cursor: null,
      completedUnits: 0,
      totalUnits: input.totalUnits ?? 0,
      attemptCount: 0,
      resultKey: null,
      resultHash: null,
      errorCode: null,
      errorMessage: null,
      errorRetryable: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
    };
    this.jobs.set(job.id, job);
    this.jobIdempotencyKeys.set(job.idempotencyKey, job.id);
    return copy(job);
  }

  async getAnalysisJob(id: string): Promise<AnalysisJobRecord | null> {
    const job = this.jobs.get(id);
    return job ? copy(job) : null;
  }

  async getJobByIdempotencyKey(idempotencyKey: string): Promise<AnalysisJobRecord | null> {
    const id = this.jobIdempotencyKeys.get(idempotencyKey);
    return id ? copy(this.jobs.get(id)!) : null;
  }

  async compareAndSetAnalysisJob(
    id: string,
    expected: AnalysisJobExpectation,
    update: AnalysisJobUpdate,
  ): Promise<AnalysisJobRecord | null> {
    const current = this.jobs.get(id);
    if (
      !current ||
      current.status !== expected.status ||
      current.stage !== expected.stage ||
      (expected.cursor !== undefined && current.cursor !== expected.cursor)
    )
      return null;
    const errorFields =
      update.error === undefined
        ? {}
        : update.error === null
          ? { errorCode: null, errorMessage: null, errorRetryable: null }
          : {
              errorCode: update.error.code,
              errorMessage: update.error.message,
              errorRetryable: update.error.retryable,
            };
    const fields = { ...update };
    const updatedAt = fields.updatedAt;
    delete fields.error;
    delete fields.updatedAt;
    const next: AnalysisJobRecord = {
      ...current,
      ...fields,
      ...errorFields,
      updatedAt: updatedAt ?? new Date().toISOString(),
    };
    this.jobs.set(id, next);
    return copy(next);
  }
}
