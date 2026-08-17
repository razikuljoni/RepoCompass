import {
  parseGitHubRepositoryId,
  parseRepositorySnapshot,
  type RepositorySnapshot,
} from "./repository-snapshot.ts";

export const analysisJobStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type AnalysisJobStatus = (typeof analysisJobStatuses)[number];

export const analysisJobStages = ["inventory", "fetch-content", "analyze", "complete"] as const;
export type AnalysisJobStage = (typeof analysisJobStages)[number];

export const analysisQueueStages = ["inventory", "fetch-content", "analyze"] as const;
export type AnalysisQueueStage = (typeof analysisQueueStages)[number];

export const analysisJobErrorCodes = [
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
] as const;
export type AnalysisJobErrorCode = (typeof analysisJobErrorCodes)[number];

export type AnalysisJobProgress = {
  stage: AnalysisJobStage;
  completedUnits: number;
  totalUnits: number;
  message?: string;
};

export type AnalysisJobError = {
  code: AnalysisJobErrorCode;
  message: string;
  retryable: boolean;
};

export type AnalysisJob = {
  jobId: string;
  analyzerVersion: string;
  idempotencyKey: string;
  snapshot: RepositorySnapshot;
  status: AnalysisJobStatus;
  progress: AnalysisJobProgress;
  error?: AnalysisJobError;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
};

export const analysisQueueMessageSchemaVersion = "1" as const;

export type AnalysisQueueMessageV1 = {
  schemaVersion: typeof analysisQueueMessageSchemaVersion;
  jobId: string;
  expectedStage: AnalysisQueueStage;
  cursor?: string;
};

export type CreateAnalysisJobRequest = {
  repositoryUrl: string;
  ref?: string;
};

export type CreateAnalysisJobInput = {
  analyzerVersion: string;
  idempotencyKey: string;
  repositoryId: string;
  requestedRef: string;
};

export type AnalysisJobResultResponse<T = unknown> = {
  jobId: string;
  status: "succeeded";
  result: T;
};

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  input: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(input)
    .filter((key) => !allowed.has(key))
    .sort()[0];
  if (unknown) throw new TypeError(`${path}.${unknown} is not allowed`);
  const missing = required.find((key) => !Object.hasOwn(input, key));
  if (missing) throw new TypeError(`${path}.${missing} is required`);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new TypeError(`${path} must be a non-empty string without surrounding whitespace`);
  }
  return value;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  values: T,
  path: string,
): T[number] {
  const result = requiredString(value, path);
  if (!values.includes(result)) throw new TypeError(`${path} is not supported`);
  return result as T[number];
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer`);
  }
  return value as number;
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : requiredString(value, path);
}

function timestamp(value: unknown, path: string): string {
  const result = requiredString(value, path);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result) ||
    Number.isNaN(Date.parse(result))
  ) {
    throw new TypeError(`${path} must be an ISO 8601 UTC timestamp`);
  }
  return result;
}

function optionalTimestamp(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : timestamp(value, path);
}

function parseRepositoryUrl(value: unknown, path: string): string {
  const result = requiredString(value, path);
  let url: URL;
  try {
    url = new URL(result);
  } catch {
    throw new TypeError(`${path} must be a canonical HTTPS github.com owner/repo URL`);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.host !== "github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9_-])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9_-])?(?:\.git)?$/.test(
      url.pathname,
    )
  ) {
    throw new TypeError(`${path} must be a canonical HTTPS github.com owner/repo URL`);
  }
  return result;
}

export function parseAnalysisJobProgress(
  value: unknown,
  path = "job.progress",
): AnalysisJobProgress {
  const input = record(value, path);
  exactKeys(input, ["stage", "completedUnits", "totalUnits"], ["message"], path);
  const progress: AnalysisJobProgress = {
    stage: enumValue(input.stage, analysisJobStages, `${path}.stage`),
    completedUnits: nonNegativeInteger(input.completedUnits, `${path}.completedUnits`),
    totalUnits: nonNegativeInteger(input.totalUnits, `${path}.totalUnits`),
  };
  if (progress.completedUnits > progress.totalUnits) {
    throw new TypeError(`${path}.completedUnits must not exceed totalUnits`);
  }
  const message = optionalString(input.message, `${path}.message`);
  if (message !== undefined) progress.message = message;
  return progress;
}

export function parseAnalysisJobError(value: unknown, path = "job.error"): AnalysisJobError {
  const input = record(value, path);
  exactKeys(input, ["code", "message", "retryable"], [], path);
  if (typeof input.retryable !== "boolean") {
    throw new TypeError(`${path}.retryable must be a boolean`);
  }
  return {
    code: enumValue(input.code, analysisJobErrorCodes, `${path}.code`),
    message: requiredString(input.message, `${path}.message`),
    retryable: input.retryable,
  };
}

export function parseAnalysisJob(value: unknown, path = "job"): AnalysisJob {
  const input = record(value, path);
  exactKeys(
    input,
    [
      "jobId",
      "analyzerVersion",
      "idempotencyKey",
      "snapshot",
      "status",
      "progress",
      "createdAt",
      "updatedAt",
    ],
    ["error", "startedAt", "completedAt"],
    path,
  );
  const job: AnalysisJob = {
    jobId: requiredString(input.jobId, `${path}.jobId`),
    analyzerVersion: requiredString(input.analyzerVersion, `${path}.analyzerVersion`),
    idempotencyKey: requiredString(input.idempotencyKey, `${path}.idempotencyKey`),
    snapshot: parseRepositorySnapshot(input.snapshot, `${path}.snapshot`),
    status: enumValue(input.status, analysisJobStatuses, `${path}.status`),
    progress: parseAnalysisJobProgress(input.progress, `${path}.progress`),
    createdAt: timestamp(input.createdAt, `${path}.createdAt`),
    updatedAt: timestamp(input.updatedAt, `${path}.updatedAt`),
  };
  const startedAt = optionalTimestamp(input.startedAt, `${path}.startedAt`);
  const completedAt = optionalTimestamp(input.completedAt, `${path}.completedAt`);
  if (startedAt !== undefined) job.startedAt = startedAt;
  if (completedAt !== undefined) job.completedAt = completedAt;
  if (input.error !== undefined) job.error = parseAnalysisJobError(input.error, `${path}.error`);
  if (job.status === "failed" && !job.error) {
    throw new TypeError(`${path}.error is required when status is failed`);
  }
  if (job.status !== "failed" && job.error) {
    throw new TypeError(`${path}.error is only allowed when status is failed`);
  }
  if (job.status === "succeeded" && job.progress.stage !== "complete") {
    throw new TypeError(`${path}.progress.stage must be complete when status is succeeded`);
  }
  if (
    (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") &&
    !job.completedAt
  ) {
    throw new TypeError(`${path}.completedAt is required for terminal status ${job.status}`);
  }
  return job;
}

export function parseAnalysisQueueMessageV1(value: unknown): AnalysisQueueMessageV1 {
  const input = record(value, "message");
  exactKeys(input, ["schemaVersion", "jobId", "expectedStage"], ["cursor"], "message");
  if (input.schemaVersion !== analysisQueueMessageSchemaVersion) {
    throw new TypeError(`message.schemaVersion must be "${analysisQueueMessageSchemaVersion}"`);
  }
  const message: AnalysisQueueMessageV1 = {
    schemaVersion: analysisQueueMessageSchemaVersion,
    jobId: requiredString(input.jobId, "message.jobId"),
    expectedStage: enumValue(input.expectedStage, analysisQueueStages, "message.expectedStage"),
  };
  const cursor = optionalString(input.cursor, "message.cursor");
  if (cursor !== undefined) message.cursor = cursor;
  return message;
}

export const parseAnalysisQueueMessage = parseAnalysisQueueMessageV1;

export function parseCreateAnalysisJobRequest(value: unknown): CreateAnalysisJobRequest {
  const input = record(value, "request");
  exactKeys(input, ["repositoryUrl"], ["ref"], "request");
  const request: CreateAnalysisJobRequest = {
    repositoryUrl: parseRepositoryUrl(input.repositoryUrl, "request.repositoryUrl"),
  };
  const ref = optionalString(input.ref, "request.ref");
  if (ref !== undefined) request.ref = ref;
  return request;
}

export function parseCreateAnalysisJobInput(value: unknown): CreateAnalysisJobInput {
  const input = record(value, "input");
  exactKeys(
    input,
    ["analyzerVersion", "idempotencyKey", "repositoryId", "requestedRef"],
    [],
    "input",
  );
  return {
    analyzerVersion: requiredString(input.analyzerVersion, "input.analyzerVersion"),
    idempotencyKey: requiredString(input.idempotencyKey, "input.idempotencyKey"),
    repositoryId: parseGitHubRepositoryId(input.repositoryId, "input.repositoryId"),
    requestedRef: requiredString(input.requestedRef, "input.requestedRef"),
  };
}

export function parseAnalysisJobResultResponse<T>(
  value: unknown,
  parseResult: (value: unknown) => T,
): AnalysisJobResultResponse<T> {
  const input = record(value, "response");
  exactKeys(input, ["jobId", "status", "result"], [], "response");
  if (input.status !== "succeeded") throw new TypeError('response.status must be "succeeded"');
  return {
    jobId: requiredString(input.jobId, "response.jobId"),
    status: "succeeded",
    result: parseResult(input.result),
  };
}
