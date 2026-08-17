import type {
  CodeGraph,
  CodeGraphV1,
  CodeGraphV2,
  GraphDiagnostic,
  GraphEdge,
  GraphEdgeV2,
  GraphEvidence,
  GraphEvidenceV2,
  GraphLocation,
  GraphNode,
  GraphNodeV2,
} from "../domain/code-graph.ts";
import type { RepositorySnapshot } from "../domain/repository-snapshot.ts";
import { parseCodeGraph } from "./code-graph-contract.ts";

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedPath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/");
}

function normalizedLocation<T extends GraphLocation>(location: T): T {
  return { ...location, path: normalizedPath(location.path) };
}

function valueKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(valueKey).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compare(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${valueKey(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function uniqueSorted<T>(items: readonly T[], key: (item: T) => string): T[] {
  const unique = new Map<string, T>();
  for (const item of items) unique.set(key(item), item);
  return [...unique.values()].sort((left, right) => compare(key(left), key(right)));
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

function canonicalSnapshot(snapshot: RepositorySnapshot): RepositorySnapshot {
  return {
    ...snapshot,
    manifest: [...snapshot.manifest].sort((left, right) => compare(left.path, right.path)),
  };
}

function canonicalizeV1(graph: CodeGraphV1): CodeGraphV1 {
  const nodes = graph.nodes
    .map((node) => ({
      ...node,
      ...(node.location ? { location: normalizedLocation(node.location) } : {}),
    }))
    .sort((left, right) => compare(nodeKey(left), nodeKey(right)));
  const uniqueEdges = new Map<string, GraphEdge>();
  for (const edge of graph.edges) {
    const normalized = {
      ...edge,
      evidence: uniqueSorted(
        edge.evidence.map((item) => normalizedLocation(item)),
        evidenceKey,
      ),
    };
    const key = edgeKey(normalized);
    const existing = uniqueEdges.get(key);
    if (existing)
      existing.evidence = uniqueSorted([...existing.evidence, ...normalized.evidence], evidenceKey);
    else uniqueEdges.set(key, normalized);
  }
  return {
    ...graph,
    snapshot: canonicalSnapshot(graph.snapshot),
    nodes,
    edges: [...uniqueEdges.values()].sort((left, right) => compare(edgeKey(left), edgeKey(right))),
  };
}

function canonicalNodeV2(node: GraphNodeV2): GraphNodeV2 {
  const location = node.location ? { ...node.location } : undefined;
  if (node.kind === "route") {
    return {
      ...node,
      ...(location ? { location } : {}),
      metadata: { ...node.metadata, methods: uniqueSorted(node.metadata.methods, (item) => item) },
    };
  }
  if (node.kind === "schema") {
    return {
      ...node,
      ...(location ? { location } : {}),
      metadata: {
        ...node.metadata,
        ...(node.metadata.fields
          ? { fields: uniqueSorted(node.metadata.fields, (item) => item) }
          : {}),
      },
    };
  }
  return {
    ...node,
    ...(location ? { location } : {}),
    metadata: { ...node.metadata },
  } as GraphNodeV2;
}

function canonicalEvidenceV2(item: GraphEvidenceV2): GraphEvidenceV2 {
  return { ...item };
}

function edgeIdentityV2(edge: GraphEdgeV2): string {
  return valueKey({
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    provenance: edge.provenance,
    ...(edge.confidence === undefined ? {} : { confidence: edge.confidence }),
    ...(edge.metadata === undefined ? {} : { metadata: edge.metadata }),
  });
}

function canonicalEdgeV2(edge: GraphEdgeV2): GraphEdgeV2 {
  return {
    ...edge,
    evidence: uniqueSorted(edge.evidence.map(canonicalEvidenceV2), valueKey),
    ...(edge.metadata
      ? {
          metadata: {
            ...edge.metadata,
            candidates: uniqueSorted(edge.metadata.candidates, (item) => item),
          },
        }
      : {}),
  };
}

function diagnosticKey(item: GraphDiagnostic): string {
  return valueKey(item);
}

function canonicalizeV2(graph: CodeGraphV2): CodeGraphV2 {
  const edgesByIdentity = new Map<string, GraphEdgeV2>();
  const canonicalEdgeIds = new Map<string, string>();
  for (const item of graph.edges.map(canonicalEdgeV2)) {
    const key = edgeIdentityV2(item);
    const existing = edgesByIdentity.get(key);
    if (existing) {
      existing.evidence = uniqueSorted([...existing.evidence, ...item.evidence], valueKey);
      const id = compare(item.id, existing.id) < 0 ? item.id : existing.id;
      canonicalEdgeIds.set(item.id, id);
      canonicalEdgeIds.set(existing.id, id);
      existing.id = id;
    } else {
      edgesByIdentity.set(key, item);
      canonicalEdgeIds.set(item.id, item.id);
    }
  }
  const edges = [...edgesByIdentity.values()].sort((left, right) =>
    compare(valueKey(left), valueKey(right)),
  );
  const diagnostics = uniqueSorted(
    graph.diagnostics.map((item) => ({
      ...item,
      ...(item.edgeId ? { edgeId: canonicalEdgeIds.get(item.edgeId) ?? item.edgeId } : {}),
      ...(item.location ? { location: { ...item.location } } : {}),
    })),
    diagnosticKey,
  );
  return {
    ...graph,
    snapshot: canonicalSnapshot(graph.snapshot),
    nodes: graph.nodes
      .map(canonicalNodeV2)
      .sort((left, right) => compare(valueKey(left), valueKey(right))),
    edges,
    diagnostics,
    metrics: {
      nodeCount: graph.nodes.length,
      edgeCount: edges.length,
      diagnosticCount: diagnostics.length,
    },
  };
}

export function canonicalizeCodeGraph(value: unknown): CodeGraph {
  const graph = parseCodeGraph(value);
  const result = graph.schemaVersion === "1.0" ? canonicalizeV1(graph) : canonicalizeV2(graph);
  return parseCodeGraph(result);
}
