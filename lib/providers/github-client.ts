import type { GitHubRepository } from "./repository-url.ts";

export type GitHubErrorCode =
  | "aborted"
  | "invalid_path"
  | "invalid_response"
  | "network"
  | "not_found"
  | "rate_limited"
  | "server_error"
  | "traversal_limit"
  | "unexpected_status";

export class GitHubClientError extends Error {
  readonly code: GitHubErrorCode;
  readonly status: number | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(code: GitHubErrorCode, message: string, status?: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "GitHubClientError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type ResolvedGitHubRevision = Readonly<{
  commitSha: string;
  treeSha: string;
}>;

export type GitHubTreeEntry = Readonly<{
  path: string;
  sha: string;
  mode: string;
  size?: number;
  kind: "blob" | "tree" | "symlink" | "submodule";
}>;

export type GitHubBlob = Readonly<{
  sha: string;
  size: number;
  encoding: "base64" | "utf-8";
  content: string;
}>;

export type GitHubClient = Readonly<{
  resolveRevision(repository: GitHubRepository, ref?: string): Promise<ResolvedGitHubRevision>;
  getTree(repository: GitHubRepository, treeSha: string): Promise<readonly GitHubTreeEntry[]>;
  getBlob(repository: GitHubRepository, blobSha: string): Promise<GitHubBlob>;
}>;

export type GitHubClientOptions = Readonly<{
  fetch: typeof fetch;
  token?: string;
  userAgent?: string;
  timeoutMs?: number;
  maxSubtrees?: number;
}>;

type ApiTreeEntry = {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
};

type ApiTree = {
  truncated?: boolean;
  tree: ApiTreeEntry[];
};

const apiBase = "https://api.github.com";
const shaPattern = /^[0-9a-f]{40}$/;
const segmentPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9_-])?$/;

function assertRepository(repository: GitHubRepository): void {
  if (!segmentPattern.test(repository.owner) || !segmentPattern.test(repository.repo)) {
    throw new GitHubClientError("invalid_path", "Invalid repository owner or name.");
  }
}

function assertSha(sha: string): void {
  if (!shaPattern.test(sha))
    throw new GitHubClientError("invalid_path", "Expected a full commit or object SHA.");
}

function assertRef(ref: string): void {
  if (
    !ref ||
    ref.length > 1024 ||
    ref.startsWith("/") ||
    ref.endsWith("/") ||
    ref.includes("..") ||
    ref.includes("//") ||
    ref.includes("@{") ||
    /[\u0000-\u0020~^:?*\\[\]]/.test(ref)
  ) {
    throw new GitHubClientError("invalid_path", "Invalid Git reference.");
  }
}

function assertEntryPath(path: string): void {
  if (
    !path ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("\\") ||
    path.includes("\u0000") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new GitHubClientError("invalid_response", "GitHub returned an invalid repository path.");
  }
}

function classify(entry: ApiTreeEntry): GitHubTreeEntry["kind"] {
  if (entry.mode === "120000" && entry.type === "blob") return "symlink";
  if (entry.mode === "160000" && entry.type === "commit") return "submodule";
  if (entry.type === "blob") return "blob";
  if (entry.type === "tree") return "tree";
  throw new GitHubClientError("invalid_response", "GitHub returned an unsupported tree entry.");
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp)
    ? undefined
    : Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
}

function mapStatus(response: Response): GitHubClientError {
  if (response.status === 404)
    return new GitHubClientError("not_found", "GitHub resource not found.", 404);
  if (
    response.status === 429 ||
    (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")
  ) {
    return new GitHubClientError(
      "rate_limited",
      "GitHub API rate limit exceeded.",
      response.status,
      parseRetryAfter(response.headers.get("retry-after")),
    );
  }
  if (response.status >= 500) {
    return new GitHubClientError(
      "server_error",
      "GitHub API is temporarily unavailable.",
      response.status,
    );
  }
  return new GitHubClientError("unexpected_status", "GitHub API request failed.", response.status);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GitHubClientError("invalid_response", "GitHub returned an invalid response.");
  }
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== "string") {
    throw new GitHubClientError("invalid_response", "GitHub returned an invalid response.");
  }
  return value;
}

function parseTree(value: unknown): ApiTree {
  const record = object(value);
  if (!Array.isArray(record.tree)) {
    throw new GitHubClientError("invalid_response", "GitHub returned an invalid tree.");
  }
  const tree = record.tree.map((value): ApiTreeEntry => {
    const entry = object(value);
    const size = entry.size;
    if (
      size !== undefined &&
      (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0)
    ) {
      throw new GitHubClientError("invalid_response", "GitHub returned an invalid tree entry.");
    }
    return {
      path: string(entry.path),
      mode: string(entry.mode),
      type: string(entry.type),
      sha: string(entry.sha),
      ...(size === undefined ? {} : { size }),
    };
  });
  return { tree, truncated: record.truncated === true };
}

export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxSubtrees = options.maxSubtrees ?? 10_000;
  const userAgent = options.userAgent ?? "RepoCompass/0.1";
  if (!userAgent.trim()) throw new TypeError("userAgent must be non-empty.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new TypeError("timeoutMs must be positive.");
  if (!Number.isSafeInteger(maxSubtrees) || maxSubtrees <= 0)
    throw new TypeError("maxSubtrees must be positive.");

  async function request(path: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await options.fetch(`${apiBase}${path}`, {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": userAgent,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
        signal: controller.signal,
      });
      if (!response.ok) throw mapStatus(response);
      try {
        return await response.json();
      } catch {
        throw new GitHubClientError("invalid_response", "GitHub returned invalid JSON.");
      }
    } catch (error) {
      if (error instanceof GitHubClientError) throw error;
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new GitHubClientError("aborted", "GitHub API request timed out.");
      }
      throw new GitHubClientError("network", "GitHub API request failed.");
    } finally {
      clearTimeout(timeout);
    }
  }

  function repositoryPath(repository: GitHubRepository): string {
    assertRepository(repository);
    return `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;
  }

  async function resolveRevision(
    repository: GitHubRepository,
    ref?: string,
  ): Promise<ResolvedGitHubRevision> {
    const base = repositoryPath(repository);
    let requestedRef = ref;
    if (requestedRef === undefined) {
      const metadata = object(await request(base));
      requestedRef = string(metadata.default_branch);
    }
    assertRef(requestedRef);
    const commit = object(await request(`${base}/commits/${encodeURIComponent(requestedRef)}`));
    const commitSha = string(commit.sha);
    const gitCommit = object(commit.commit);
    const treeSha = string(object(gitCommit.tree).sha);
    assertSha(commitSha);
    assertSha(treeSha);
    return Object.freeze({ commitSha, treeSha });
  }

  function convert(entry: ApiTreeEntry, prefix = ""): GitHubTreeEntry {
    assertEntryPath(entry.path);
    assertSha(entry.sha);
    const path = prefix ? `${prefix}/${entry.path}` : entry.path;
    assertEntryPath(path);
    return Object.freeze({
      path,
      sha: entry.sha,
      mode: entry.mode,
      ...(entry.size === undefined ? {} : { size: entry.size }),
      kind: classify(entry),
    });
  }

  async function getTree(
    repository: GitHubRepository,
    treeSha: string,
  ): Promise<readonly GitHubTreeEntry[]> {
    const base = repositoryPath(repository);
    assertSha(treeSha);
    const recursive = parseTree(await request(`${base}/git/trees/${treeSha}?recursive=1`));
    if (!recursive.truncated) return Object.freeze(recursive.tree.map((entry) => convert(entry)));

    const root = parseTree(await request(`${base}/git/trees/${treeSha}`));
    const result: GitHubTreeEntry[] = [];
    const queue: Array<{ sha: string; prefix: string }> = [];
    let visited = 0;
    for (const entry of root.tree) {
      const converted = convert(entry);
      result.push(converted);
      if (converted.kind === "tree") queue.push({ sha: converted.sha, prefix: converted.path });
    }
    while (queue.length > 0) {
      if (++visited > maxSubtrees) {
        throw new GitHubClientError(
          "traversal_limit",
          "Repository tree exceeds the traversal limit.",
        );
      }
      const current = queue.shift()!;
      const subtree = parseTree(await request(`${base}/git/trees/${current.sha}`));
      for (const entry of subtree.tree) {
        const converted = convert(entry, current.prefix);
        result.push(converted);
        if (converted.kind === "tree") queue.push({ sha: converted.sha, prefix: converted.path });
      }
    }
    return Object.freeze(result);
  }

  async function getBlob(repository: GitHubRepository, blobSha: string): Promise<GitHubBlob> {
    const base = repositoryPath(repository);
    assertSha(blobSha);
    const blob = object(await request(`${base}/git/blobs/${blobSha}`));
    const sha = string(blob.sha);
    const content = string(blob.content);
    const encoding = string(blob.encoding);
    const size = blob.size;
    assertSha(sha);
    if (encoding !== "base64" && encoding !== "utf-8") {
      throw new GitHubClientError(
        "invalid_response",
        "GitHub returned an unsupported blob encoding.",
      );
    }
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
      throw new GitHubClientError("invalid_response", "GitHub returned an invalid blob size.");
    }
    return Object.freeze({ sha, size, encoding, content });
  }

  return Object.freeze({ resolveRevision, getTree, getBlob });
}
