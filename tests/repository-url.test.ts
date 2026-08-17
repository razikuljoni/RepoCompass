import assert from "node:assert/strict";
import test from "node:test";
import { RepositoryUrlError, parseGitHubRepositoryUrl } from "../lib/providers/repository-url.ts";

test("parses canonical GitHub repository URLs", () => {
  assert.deepStrictEqual(parseGitHubRepositoryUrl("https://github.com/owner/repo"), {
    owner: "owner",
    repo: "repo",
  });
  assert.deepStrictEqual(parseGitHubRepositoryUrl("https://github.com/owner/repo.git"), {
    owner: "owner",
    repo: "repo",
  });
  assert.equal(Object.isFrozen(parseGitHubRepositoryUrl("https://github.com/owner/repo")), true);
});

test("rejects non-canonical repository URLs", () => {
  const invalid = [
    "http://github.com/owner/repo",
    "https://www.github.com/owner/repo",
    "https://user@github.com/owner/repo",
    "https://user:password@github.com/owner/repo",
    "https://github.com:443/owner/repo",
    "https://github.com/owner/repo?tab=readme",
    "https://github.com/owner/repo#readme",
    "https://github.com/owner",
    "https://github.com/owner/repo/issues",
    "https://github.com/owner/repo/",
    "git@github.com:owner/repo.git",
    "https://github.com//repo",
    "https://github.com/owner/.git",
  ];
  for (const value of invalid) {
    assert.throws(() => parseGitHubRepositoryUrl(value), RepositoryUrlError, value);
  }
});
