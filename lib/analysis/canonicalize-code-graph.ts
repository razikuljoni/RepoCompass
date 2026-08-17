import type {
  CodeGraph,
  GraphEdge,
  GraphEvidence,
  GraphLocation,
  GraphNode,
} from "../domain/code-graph.ts";
import { parseCodeGraph } from "./code-graph-contract.ts";

function normalizedPath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/");
}

function normalizedLocation<T extends GraphLocation>(location: T): T {
  return { ...location, path: normalizedPath(location.path) };
}

function nodeKey(node: GraphNode): string {
  return `${node.kind}\u0000${node.id}`;
}

function evidenceKey(item: GraphEvidence): string {
  return [item.path, item.startLine || 0, item.endLine || 0, item.excerptHash || ""].join("\u0000");
}

function edgeKey(edge: GraphEdge): string {
  return [edge.from, edge.to, edge.kind, edge.provenance, edge.confidence ?? ""].join("\u0000");
}

export function canonicalizeCodeGraph(value: unknown): CodeGraph {
  const graph = parseCodeGraph(value);
  const nodes = graph.nodes
    .map((node) => ({
      ...node,
      ...(node.location ? { location: normalizedLocation(node.location) } : {}),
    }))
    .sort((left, right) => nodeKey(left).localeCompare(nodeKey(right)));
  const uniqueEdges = new Map<string, GraphEdge>();
  for (const edge of graph.edges) {
    const normalized = {
      ...edge,
      evidence: edge.evidence
        .map((item) => normalizedLocation(item))
        .sort((left, right) => evidenceKey(left).localeCompare(evidenceKey(right))),
    };
    const key = edgeKey(normalized);
    const existing = uniqueEdges.get(key);
    if (existing) {
      existing.evidence = [...existing.evidence, ...normalized.evidence]
        .filter(
          (item, index, all) =>
            all.findIndex((candidate) => evidenceKey(candidate) === evidenceKey(item)) === index,
        )
        .sort((left, right) => evidenceKey(left).localeCompare(evidenceKey(right)));
    } else {
      uniqueEdges.set(key, normalized);
    }
  }
  return {
    ...graph,
    nodes,
    edges: [...uniqueEdges.values()].sort((left, right) =>
      edgeKey(left).localeCompare(edgeKey(right)),
    ),
  };
}
