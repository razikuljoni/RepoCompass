import assert from "node:assert/strict";
import test from "node:test";
import { GitHubClientError, createGitHubClient } from "../lib/providers/github-client.ts";

const commitSha = "a".repeat(40);
const treeSha = "b".repeat(40);
const blobSha = "c".repeat(40);
const subtreeSha = "d".repeat(40);
const repository = Object.freeze({ owner: "octo", repo: "project" });

function json(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function fetchSequence(
  responses: Array<Response | ((url: string, init?: RequestInit) => Response | Promise<Response>)>,
  requests: Array<{ url: string; init?: RequestInit }> = [],
): { fetch: typeof fetch; requests: Array<{ url: string; init?: RequestInit }> } {
  const injected = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    requests.push({ url, init });
    const response = responses.shift();
    assert.ok(response, `Unexpected request: ${url}`);
    return typeof response === "function" ? response(url, init) : response;
  };
  return { fetch: injected as typeof fetch, requests };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<GitHubClientError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof GitHubClientError);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`Expected ${code}`);
}

test("resolves the default ref to immutable commit and tree SHAs", async () => {
  const mock = fetchSequence([
    json({ default_branch: "main" }),
    json({ sha: commitSha, commit: { tree: { sha: treeSha } } }),
  ]);
  const client = createGitHubClient({ fetch: mock.fetch });
  const revision = await client.resolveRevision(repository);
  assert.deepStrictEqual(revision, { commitSha, treeSha });
  assert.equal(Object.isFrozen(revision), true);
  assert.deepStrictEqual(
    mock.requests.map(({ url }) => url),
    [
      "https://api.github.com/repos/octo/project",
      "https://api.github.com/repos/octo/project/commits/main",
    ],
  );
  assert.equal(mock.requests[0].init?.signal instanceof AbortSignal, true);
  assert.equal(new Headers(mock.requests[0].init?.headers).get("user-agent"), "RepoCompass/0.1");
});

test("resolves a requested ref before tree access", async () => {
  const mock = fetchSequence([
    json({ sha: commitSha, commit: { tree: { sha: treeSha } } }),
    json({
      truncated: false,
      tree: [{ path: "src/app.ts", mode: "100644", type: "blob", sha: blobSha, size: 7 }],
    }),
  ]);
  const client = createGitHubClient({ fetch: mock.fetch });
  const revision = await client.resolveRevision(repository, "feature/x");
  const entries = await client.getTree(repository, revision.treeSha);
  assert.equal(mock.requests[0].url.endsWith("/commits/feature%2Fx"), true);
  assert.equal(
    mock.requests[1].url,
    `https://api.github.com/repos/octo/project/git/trees/${treeSha}?recursive=1`,
  );
  assert.deepStrictEqual(entries, [
    { path: "src/app.ts", mode: "100644", kind: "blob", sha: blobSha, size: 7 },
  ]);
  assert.equal(Object.isFrozen(entries), true);
  assert.equal(Object.isFrozen(entries[0]), true);
});

test("falls back from a truncated recursive tree to bounded subtree traversal", async () => {
  const mock = fetchSequence([
    json({ truncated: true, tree: [] }),
    json({
      truncated: false,
      tree: [
        { path: "src", mode: "040000", type: "tree", sha: subtreeSha },
        { path: "link", mode: "120000", type: "blob", sha: blobSha, size: 3 },
        { path: "vendor", mode: "160000", type: "commit", sha: commitSha },
      ],
    }),
    json({
      truncated: false,
      tree: [{ path: "index.ts", mode: "100644", type: "blob", sha: blobSha, size: 9 }],
    }),
  ]);
  const client = createGitHubClient({ fetch: mock.fetch, maxSubtrees: 2 });
  const entries = await client.getTree(repository, treeSha);
  assert.deepStrictEqual(
    entries.map(({ path, kind }) => ({ path, kind })),
    [
      { path: "src", kind: "tree" },
      { path: "link", kind: "symlink" },
      { path: "vendor", kind: "submodule" },
      { path: "src/index.ts", kind: "blob" },
    ],
  );
  assert.equal(mock.requests[2].url.endsWith(`/git/trees/${subtreeSha}`), true);
});

test("enforces subtree traversal bounds", async () => {
  const mock = fetchSequence([
    json({ truncated: true, tree: [] }),
    json({ tree: [{ path: "a", mode: "040000", type: "tree", sha: subtreeSha }] }),
    json({ tree: [{ path: "b", mode: "040000", type: "tree", sha: treeSha }] }),
  ]);
  const client = createGitHubClient({ fetch: mock.fetch, maxSubtrees: 1 });
  await expectCode(client.getTree(repository, treeSha), "traversal_limit");
});

test("retrieves blobs only by full immutable SHA", async () => {
  const mock = fetchSequence([
    json({ sha: blobSha, size: 3, encoding: "base64", content: "YWJj\n" }),
  ]);
  const client = createGitHubClient({ fetch: mock.fetch });
  const blob = await client.getBlob(repository, blobSha);
  assert.deepStrictEqual(blob, { sha: blobSha, size: 3, encoding: "base64", content: "YWJj\n" });
  assert.equal(Object.isFrozen(blob), true);
  assert.equal(mock.requests[0].url.endsWith(`/git/blobs/${blobSha}`), true);
  await expectCode(client.getBlob(repository, "main"), "invalid_path");
  assert.equal(mock.requests.length, 1);
});

test("rejects unsafe refs and paths", async () => {
  const client = createGitHubClient({ fetch: fetchSequence([]).fetch });
  await expectCode(client.resolveRevision(repository, "../main"), "invalid_path");
  await expectCode(client.getTree(repository, "short"), "invalid_path");

  const mock = fetchSequence([
    json({ tree: [{ path: "../secret", mode: "100644", type: "blob", sha: blobSha }] }),
  ]);
  await expectCode(
    createGitHubClient({ fetch: mock.fetch }).getTree(repository, treeSha),
    "invalid_response",
  );
});

test("maps safe typed HTTP and network errors", async () => {
  for (const [status, code] of [
    [404, "not_found"],
    [429, "rate_limited"],
    [503, "server_error"],
    [400, "unexpected_status"],
  ] as const) {
    const response = new Response("sensitive upstream detail", {
      status,
      headers: status === 429 ? { "retry-after": "12" } : undefined,
    });
    const error = await expectCode(
      createGitHubClient({ fetch: fetchSequence([response]).fetch }).getBlob(repository, blobSha),
      code,
    );
    assert.equal(error.message.includes("sensitive"), false);
    if (status === 429) assert.equal(error.retryAfterSeconds, 12);
  }

  const limited403 = new Response(null, {
    status: 403,
    headers: { "x-ratelimit-remaining": "0" },
  });
  await expectCode(
    createGitHubClient({ fetch: fetchSequence([limited403]).fetch }).getBlob(repository, blobSha),
    "rate_limited",
  );

  const authenticated = fetchSequence([
    json({ sha: blobSha, size: 0, encoding: "utf-8", content: "" }),
  ]);
  await createGitHubClient({ fetch: authenticated.fetch, token: "token" }).getBlob(
    repository,
    blobSha,
  );
  assert.equal(
    new Headers(authenticated.requests[0].init?.headers).get("authorization"),
    "Bearer token",
  );

  const failing = (() => Promise.reject(new Error("secret network details"))) as typeof fetch;
  const error = await expectCode(
    createGitHubClient({ fetch: failing }).getBlob(repository, blobSha),
    "network",
  );
  assert.equal(error.message.includes("secret"), false);
});

test("aborts requests after the configured timeout", async () => {
  const hanging = ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")),
      );
    })) as typeof fetch;
  const client = createGitHubClient({ fetch: hanging, timeoutMs: 5 });
  await expectCode(client.getBlob(repository, blobSha), "aborted");
});
