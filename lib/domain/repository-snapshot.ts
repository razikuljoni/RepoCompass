export const githubObjectShaPattern = /^[0-9a-f]{40}$/;
export const sha256Pattern = /^[0-9a-f]{64}$/;
export const githubRepositoryIdPattern =
  /^github:[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9_-])?\/[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9_-])?$/;

export const repositorySnapshotLimits = {
  maxInventoryEntries: 10_000,
  maxAnalyzedFiles: 100,
  maxDecodedBytesPerFile: 120_000,
  maxDecodedTotalBytes: 10_000_000,
  contentFetchBatchSize: 10,
} as const;

export const repositoryManifestEntryKinds = ["blob", "symlink", "submodule"] as const;
export type RepositoryManifestEntryKind = (typeof repositoryManifestEntryKinds)[number];

export type RepositoryManifestEntry = {
  path: string;
  kind: RepositoryManifestEntryKind;
  mode: string;
  gitObjectSha: string;
  size: number;
  eligibleForAnalysis: boolean;
  exclusionReason?: string;
  contentKey?: string;
  contentSha256?: string;
};

export type RepositorySnapshotLimits = typeof repositorySnapshotLimits;

export type RepositorySnapshotCoverage = {
  discoveredFiles: number;
  analyzedFiles: number;
  skippedFiles: number;
  discoveredBytes: number;
  analyzedBytes: number;
  truncated: boolean;
};

export type RepositorySnapshot = {
  snapshotId: string;
  provider: "github";
  repositoryId: string;
  requestedRef: string;
  commitSha: string;
  treeSha: string;
  manifest: RepositoryManifestEntry[];
  limits: RepositorySnapshotLimits;
  coverage: RepositorySnapshotCoverage;
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

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer`);
  }
  return value as number;
}

export function parseGitHubObjectSha(value: unknown, path = "sha"): string {
  if (typeof value !== "string" || !githubObjectShaPattern.test(value)) {
    throw new TypeError(`${path} must be a lowercase 40-character hexadecimal GitHub object SHA`);
  }
  return value;
}

export const parseGitHubCommitSha = parseGitHubObjectSha;

export function parseGitHubRepositoryId(value: unknown, path = "repositoryId"): string {
  if (typeof value !== "string" || !githubRepositoryIdPattern.test(value)) {
    throw new TypeError(`${path} must use canonical lowercase github:owner/repo format`);
  }
  return value;
}

export function parseSafeRepositoryPath(value: unknown, path = "path"): string {
  const result = requiredString(value, path);
  if (
    result.startsWith("/") ||
    result.endsWith("/") ||
    result.includes("\\") ||
    result.includes("\0") ||
    /[\u0001-\u001f\u007f]/.test(result) ||
    result.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new TypeError(`${path} must be a safe repository-relative path`);
  }
  return result;
}

function parseManifestKind(value: unknown, path: string): RepositoryManifestEntryKind {
  if (
    typeof value !== "string" ||
    !repositoryManifestEntryKinds.includes(value as RepositoryManifestEntryKind)
  ) {
    throw new TypeError(`${path} must be blob, symlink, or submodule`);
  }
  return value as RepositoryManifestEntryKind;
}

function parseMode(value: unknown, kind: RepositoryManifestEntryKind, path: string): string {
  const mode = requiredString(value, path);
  const valid =
    (kind === "blob" && (mode === "100644" || mode === "100755")) ||
    (kind === "symlink" && mode === "120000") ||
    (kind === "submodule" && mode === "160000");
  if (!valid) throw new TypeError(`${path} does not match entry kind ${kind}`);
  return mode;
}

function optionalSha256(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    throw new TypeError(`${path} must be a lowercase 64-character SHA-256 digest`);
  }
  return value;
}

export function parseRepositoryManifestEntry(
  value: unknown,
  path = "manifest entry",
): RepositoryManifestEntry {
  const input = record(value, path);
  exactKeys(
    input,
    ["path", "kind", "mode", "gitObjectSha", "size", "eligibleForAnalysis"],
    ["exclusionReason", "contentKey", "contentSha256"],
    path,
  );
  const kind = parseManifestKind(input.kind, `${path}.kind`);
  if (typeof input.eligibleForAnalysis !== "boolean") {
    throw new TypeError(`${path}.eligibleForAnalysis must be a boolean`);
  }
  if (kind !== "blob" && input.eligibleForAnalysis) {
    throw new TypeError(`${path}.eligibleForAnalysis must be false for ${kind} entries`);
  }
  const entry: RepositoryManifestEntry = {
    path: parseSafeRepositoryPath(input.path, `${path}.path`),
    kind,
    mode: parseMode(input.mode, kind, `${path}.mode`),
    gitObjectSha: parseGitHubObjectSha(input.gitObjectSha, `${path}.gitObjectSha`),
    size: nonNegativeInteger(input.size, `${path}.size`),
    eligibleForAnalysis: input.eligibleForAnalysis,
  };
  if (input.exclusionReason !== undefined) {
    entry.exclusionReason = requiredString(input.exclusionReason, `${path}.exclusionReason`);
  }
  if (entry.eligibleForAnalysis && entry.exclusionReason !== undefined) {
    throw new TypeError(`${path}.exclusionReason is not allowed when eligibleForAnalysis is true`);
  }
  if (input.contentKey !== undefined) {
    entry.contentKey = requiredString(input.contentKey, `${path}.contentKey`);
  }
  const contentSha256 = optionalSha256(input.contentSha256, `${path}.contentSha256`);
  if (contentSha256 !== undefined) entry.contentSha256 = contentSha256;
  if (
    (entry.contentKey !== undefined || entry.contentSha256 !== undefined) &&
    !entry.eligibleForAnalysis
  ) {
    throw new TypeError(`${path} content metadata requires an analysis-eligible blob`);
  }
  return entry;
}

export function parseRepositorySnapshotLimits(
  value: unknown,
  path = "limits",
): RepositorySnapshotLimits {
  const input = record(value, path);
  const keys = Object.keys(repositorySnapshotLimits);
  exactKeys(input, keys, [], path);
  for (const key of keys as (keyof RepositorySnapshotLimits)[]) {
    if (input[key] !== repositorySnapshotLimits[key]) {
      throw new TypeError(`${path}.${key} must be ${repositorySnapshotLimits[key]}`);
    }
  }
  return { ...repositorySnapshotLimits };
}

export function parseRepositorySnapshotCoverage(
  value: unknown,
  path = "coverage",
): RepositorySnapshotCoverage {
  const input = record(value, path);
  exactKeys(
    input,
    [
      "discoveredFiles",
      "analyzedFiles",
      "skippedFiles",
      "discoveredBytes",
      "analyzedBytes",
      "truncated",
    ],
    [],
    path,
  );
  const coverage = {
    discoveredFiles: nonNegativeInteger(input.discoveredFiles, `${path}.discoveredFiles`),
    analyzedFiles: nonNegativeInteger(input.analyzedFiles, `${path}.analyzedFiles`),
    skippedFiles: nonNegativeInteger(input.skippedFiles, `${path}.skippedFiles`),
    discoveredBytes: nonNegativeInteger(input.discoveredBytes, `${path}.discoveredBytes`),
    analyzedBytes: nonNegativeInteger(input.analyzedBytes, `${path}.analyzedBytes`),
    truncated: input.truncated,
  };
  if (typeof coverage.truncated !== "boolean") {
    throw new TypeError(`${path}.truncated must be a boolean`);
  }
  if (coverage.analyzedFiles + coverage.skippedFiles > coverage.discoveredFiles) {
    throw new TypeError(`${path} file counts are inconsistent`);
  }
  if (coverage.analyzedBytes > coverage.discoveredBytes) {
    throw new TypeError(`${path} byte counts are inconsistent`);
  }
  if (coverage.discoveredFiles > repositorySnapshotLimits.maxInventoryEntries) {
    throw new TypeError(`${path}.discoveredFiles exceeds the inventory limit`);
  }
  if (coverage.analyzedFiles > repositorySnapshotLimits.maxAnalyzedFiles) {
    throw new TypeError(`${path}.analyzedFiles exceeds the analysis limit`);
  }
  if (coverage.analyzedBytes > repositorySnapshotLimits.maxDecodedTotalBytes) {
    throw new TypeError(`${path}.analyzedBytes exceeds the decoded byte limit`);
  }
  return coverage as RepositorySnapshotCoverage;
}

export function parseRepositorySnapshot(value: unknown, path = "snapshot"): RepositorySnapshot {
  const input = record(value, path);
  exactKeys(
    input,
    [
      "snapshotId",
      "provider",
      "repositoryId",
      "requestedRef",
      "commitSha",
      "treeSha",
      "manifest",
      "limits",
      "coverage",
    ],
    [],
    path,
  );
  if (input.provider !== "github") throw new TypeError(`${path}.provider must be "github"`);
  if (!Array.isArray(input.manifest)) throw new TypeError(`${path}.manifest must be an array`);
  const limits = parseRepositorySnapshotLimits(input.limits, `${path}.limits`);
  if (input.manifest.length > limits.maxInventoryEntries) {
    throw new TypeError(`${path}.manifest exceeds limits.maxInventoryEntries`);
  }
  const manifest = input.manifest.map((entry, index) =>
    parseRepositoryManifestEntry(entry, `${path}.manifest[${index}]`),
  );
  if (new Set(manifest.map((entry) => entry.path)).size !== manifest.length) {
    throw new TypeError(`${path}.manifest contains duplicate paths`);
  }
  const eligible = manifest.filter((entry) => entry.eligibleForAnalysis);
  if (eligible.length > limits.maxAnalyzedFiles) {
    throw new TypeError(`${path}.manifest exceeds limits.maxAnalyzedFiles`);
  }
  if (eligible.some((entry) => entry.size > limits.maxDecodedBytesPerFile)) {
    throw new TypeError(`${path}.manifest contains an eligible file exceeding the per-file limit`);
  }
  const coverage = parseRepositorySnapshotCoverage(input.coverage, `${path}.coverage`);
  if (coverage.discoveredFiles < manifest.length) {
    throw new TypeError(`${path}.coverage.discoveredFiles cannot be less than manifest length`);
  }
  if (coverage.analyzedFiles > eligible.length) {
    throw new TypeError(`${path}.coverage.analyzedFiles exceeds eligible manifest entries`);
  }
  return {
    snapshotId: requiredString(input.snapshotId, `${path}.snapshotId`),
    provider: "github",
    repositoryId: parseGitHubRepositoryId(input.repositoryId, `${path}.repositoryId`),
    requestedRef: requiredString(input.requestedRef, `${path}.requestedRef`),
    commitSha: parseGitHubObjectSha(input.commitSha, `${path}.commitSha`),
    treeSha: parseGitHubObjectSha(input.treeSha, `${path}.treeSha`),
    manifest,
    limits,
    coverage,
  };
}

export function repositorySnapshotsEqual(
  left: RepositorySnapshot,
  right: RepositorySnapshot,
): boolean {
  return (
    left.snapshotId === right.snapshotId &&
    left.provider === right.provider &&
    left.repositoryId === right.repositoryId &&
    left.commitSha === right.commitSha &&
    left.treeSha === right.treeSha
  );
}
