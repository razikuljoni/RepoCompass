import { canonicalizeCodeGraph } from "./canonicalize-code-graph.ts";
import type { CodeGraph, GraphNode, GraphNodeV2 } from "../domain/code-graph.ts";

export const repositoryAnswerSchemaVersion = "1.0" as const;

export type RepositoryCitation = {
  id: string;
  path: string;
  startLine?: number;
  endLine?: number;
  commitSha: string;
};

export type RepositoryClaim = {
  text: string;
  citationIds: string[];
};

export type RepositoryAnswer = {
  schemaVersion: typeof repositoryAnswerSchemaVersion;
  question: string;
  verifiedFacts: RepositoryClaim[];
  inferences: RepositoryClaim[];
  unknowns: string[];
  citations: RepositoryCitation[];
  confidence: "high" | "medium" | "insufficient";
};

type QueryNode = GraphNode | GraphNodeV2;

function searchable(node: QueryNode): string {
  const metadata = "metadata" in node ? JSON.stringify(node.metadata) : (node.language ?? "");
  return [node.name, node.kind, node.location?.path ?? "", metadata].join(" ").toLowerCase();
}

function questionTokens(question: string): string[] {
  return [...new Set(question.toLowerCase().match(/[a-z0-9_@./-]{3,}/g) ?? [])]
    .filter(
      (token) =>
        !new Set([
          "and",
          "are",
          "does",
          "from",
          "how",
          "repository",
          "the",
          "this",
          "what",
          "where",
          "which",
          "with",
        ]).has(token),
    )
    .slice(0, 12);
}

function nodeFact(node: QueryNode): string {
  if (node.kind === "route" && "metadata" in node) {
    return `${node.metadata.methods.join(", ")} ${node.metadata.path} is declared in ${node.location?.path}.`;
  }
  return `${node.kind} ${node.name} is declared in ${node.location?.path}.`;
}

export function answerRepositoryQuestion(
  graphValue: CodeGraph,
  questionValue: string,
): RepositoryAnswer {
  const question = questionValue.trim();
  if (!question || question.length > 512) {
    throw new TypeError("Question must contain between 1 and 512 characters.");
  }
  const graph = canonicalizeCodeGraph(graphValue);
  const nodes = graph.nodes as QueryNode[];
  const routeIntent = /\b(api|endpoint|request|route)\b/i.test(question);
  const tokens = questionTokens(question);
  const matches = nodes
    .filter((node) => node.location?.path)
    .map((node) => ({
      node,
      score:
        (routeIntent && node.kind === "route" ? 100 : 0) +
        tokens.reduce((score, token) => score + (searchable(node).includes(token) ? 1 : 0), 0),
    }))
    .filter((match) => match.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.node.location!.path.localeCompare(right.node.location!.path) ||
        left.node.name.localeCompare(right.node.name),
    )
    .slice(0, 10);
  const citations = matches.map(({ node }, index) => ({
    id: `citation-${index + 1}`,
    path: node.location!.path,
    ...(node.location!.startLine === undefined ? {} : { startLine: node.location!.startLine }),
    ...(node.location!.endLine === undefined ? {} : { endLine: node.location!.endLine }),
    commitSha: graph.snapshot.commitSha,
  }));
  const verifiedFacts = matches.map(({ node }, index) => ({
    text: nodeFact(node),
    citationIds: [citations[index].id],
  }));
  return {
    schemaVersion: repositoryAnswerSchemaVersion,
    question,
    verifiedFacts,
    inferences: [],
    unknowns: verifiedFacts.length
      ? []
      : ["Indexed graph contains insufficient evidence to answer this question."],
    citations,
    confidence:
      verifiedFacts.length >= 3 ? "high" : verifiedFacts.length ? "medium" : "insufficient",
  };
}
