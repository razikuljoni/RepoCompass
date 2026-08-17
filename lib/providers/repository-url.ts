export type GitHubRepository = Readonly<{
  owner: string;
  repo: string;
}>;

export class RepositoryUrlError extends Error {
  readonly code = "invalid_repository_url" as const;

  constructor(message = "Repository URL must be a canonical HTTPS github.com owner/repo URL.") {
    super(message);
    this.name = "RepositoryUrlError";
  }
}

const segmentPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9_-])?$/;

export function parseGitHubRepositoryUrl(value: string): GitHubRepository {
  let url: URL;
  if (/^https:\/\/github\.com:/i.test(value)) throw new RepositoryUrlError();
  try {
    url = new URL(value);
  } catch {
    throw new RepositoryUrlError();
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.host !== "github.com" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new RepositoryUrlError();
  }

  const match = /^\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url.pathname);
  if (!match) throw new RepositoryUrlError();
  const [, owner, repo] = match;
  if (
    !segmentPattern.test(owner) ||
    !segmentPattern.test(repo) ||
    owner === "." ||
    owner === ".." ||
    repo === "." ||
    repo === ".."
  ) {
    throw new RepositoryUrlError();
  }

  return Object.freeze({ owner, repo });
}
