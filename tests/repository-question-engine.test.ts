import assert from "node:assert/strict";
import test from "node:test";
import { answerRepositoryQuestion } from "../lib/analysis/repository-question-engine.ts";
import type { CodeGraph } from "../lib/domain/code-graph.ts";
import { repositorySnapshotLimits } from "../lib/domain/repository-snapshot.ts";

const graph: CodeGraph = {
  schemaVersion: "1.0",
  snapshot: {
    snapshotId: "snapshot-1",
    provider: "github",
    repositoryId: "github:example/project",
    requestedRef: "main",
    commitSha: "a".repeat(40),
    treeSha: "b".repeat(40),
    manifest: [],
    limits: repositorySnapshotLimits,
    coverage: {
      discoveredFiles: 0,
      analyzedFiles: 0,
      skippedFiles: 0,
      discoveredBytes: 0,
      analyzedBytes: 0,
      truncated: false,
    },
  },
  nodes: [
    {
      id: "symbol:login",
      kind: "symbol",
      name: "loginUser",
      location: { path: "src/auth.ts", startLine: 12, endLine: 18 },
    },
    {
      id: "route:login",
      kind: "route",
      name: "POST /login",
      location: { path: "src/routes.ts", startLine: 7, endLine: 7 },
    },
  ],
  edges: [],
};

test("answers with commit-pinned citations and no unsupported inferences", () => {
  const answer = answerRepositoryQuestion(graph, "Where is login handled?");
  assert.deepStrictEqual(
    answer.citations.map((citation) => [citation.path, citation.startLine, citation.commitSha]),
    [
      ["src/auth.ts", 12, "a".repeat(40)],
      ["src/routes.ts", 7, "a".repeat(40)],
    ],
  );
  assert.equal(answer.verifiedFacts.length, 2);
  assert.deepStrictEqual(answer.inferences, []);
  assert.deepStrictEqual(answer.unknowns, []);
});

test("reports insufficient evidence instead of generating an answer", () => {
  const answer = answerRepositoryQuestion(graph, "How is billing reconciled?");
  assert.deepStrictEqual(answer.verifiedFacts, []);
  assert.equal(answer.confidence, "insufficient");
  assert.equal(answer.unknowns.length, 1);
});
