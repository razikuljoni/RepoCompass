import { canonicalizeCodeGraph } from "./canonicalize-code-graph.ts";
import type {
  CodeGraph,
  GraphEdge,
  GraphEdgeV2,
  GraphNode,
  GraphNodeV2,
} from "../domain/code-graph.ts";
import type { GraphQuery, GraphQueryDirection, QueryEdgeKind } from "./graph-query-contract.ts";

export type QueryGraphNode = GraphNode | GraphNodeV2;
export type QueryGraphEdge = GraphEdge | GraphEdgeV2;

export const graphQueryResponseSchemaVersion = "1.0" as const;

export type GraphQueryTruncationReason = "cost" | "results" | "time";

export type GraphQueryResponse = {
  schemaVersion: typeof graphQueryResponseSchemaVersion;
  query: GraphQuery;
  nodes: QueryGraphNode[];
  edges: QueryGraphEdge[];
  path: string[] | null;
  cost: number;
  truncated: boolean;
  truncationReason: GraphQueryTruncationReason | null;
  nextCursor: number | null;
};

type IndexedEdge = { edge: QueryGraphEdge; key: string };

function edgeKey(edge: QueryGraphEdge): string {
  return "id" in edge ? edge.id : [edge.from, edge.to, edge.kind, edge.provenance].join("\u0000");
}

function searchText(node: QueryGraphNode): string {
  const metadata = "metadata" in node ? JSON.stringify(node.metadata) : (node.language ?? "");
  return [node.id, node.name, node.kind, node.location?.path ?? "", metadata]
    .join("\u0000")
    .toLocaleLowerCase("en-US");
}

function permits(
  edge: QueryGraphEdge,
  nodeId: string,
  direction: GraphQueryDirection,
  kinds?: readonly QueryEdgeKind[],
): boolean {
  if (kinds && !kinds.includes(edge.kind)) return false;
  return (
    (direction !== "incoming" && edge.from === nodeId) ||
    (direction !== "outgoing" && edge.to === nodeId)
  );
}

function other(edge: QueryGraphEdge, nodeId: string): string {
  return edge.from === nodeId ? edge.to : edge.from;
}

export function executeGraphQuery(graphValue: unknown, query: GraphQuery): GraphQueryResponse {
  const graph = canonicalizeCodeGraph(graphValue);
  const nodes = graph.nodes as QueryGraphNode[];
  const edges = graph.edges as QueryGraphEdge[];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const sortedEdges: IndexedEdge[] = edges
    .map((edge) => ({ edge, key: edgeKey(edge) }))
    .sort((left, right) => left.key.localeCompare(right.key));
  let cost = 0;
  let truncationReason: GraphQueryTruncationReason | null = null;
  const deadline = Date.now() + query.budget.maxTimeMs;
  const charge = (): boolean => {
    if (Date.now() >= deadline) {
      truncationReason = "time";
      return false;
    }
    if (cost >= query.budget.maxCost) {
      truncationReason = "cost";
      return false;
    }
    cost += 1;
    return true;
  };
  const response = (
    resultNodes: QueryGraphNode[],
    resultEdges: QueryGraphEdge[],
    path: string[] | null = null,
    nextCursor: number | null = null,
  ): GraphQueryResponse => ({
    schemaVersion: graphQueryResponseSchemaVersion,
    query,
    nodes: resultNodes,
    edges: resultEdges,
    path,
    cost,
    truncated: truncationReason !== null,
    truncationReason,
    nextCursor,
  });

  if (query.type === "search") {
    const needle = query.text.toLocaleLowerCase("en-US");
    const matches: QueryGraphNode[] = [];
    let matchIndex = 0;
    for (const node of nodes) {
      if (!charge()) break;
      if ((!query.kinds || query.kinds.includes(node.kind)) && searchText(node).includes(needle)) {
        if (matchIndex++ < query.cursor) continue;
        if (matches.length === query.budget.maxResults) {
          truncationReason = "results";
          break;
        }
        matches.push(node);
      }
    }
    const nextCursor = truncationReason === "results" ? query.cursor + matches.length : null;
    return response(matches, [], null, nextCursor);
  }

  if (query.type === "node") {
    charge();
    const node = nodeById.get(query.nodeId);
    return response(node ? [node] : [], []);
  }

  if (query.type === "neighbors" || query.type === "explain") {
    const direction = query.type === "explain" ? "both" : query.direction;
    const kinds = query.type === "explain" ? undefined : query.edgeKinds;
    const cursor = query.type === "neighbors" ? query.cursor : 0;
    const selectedEdges: QueryGraphEdge[] = [];
    let matchIndex = 0;
    for (const item of sortedEdges) {
      if (!charge()) break;
      if (!permits(item.edge, query.nodeId, direction, kinds)) continue;
      if (matchIndex++ < cursor) continue;
      if (selectedEdges.length === query.budget.maxResults) {
        truncationReason = "results";
        break;
      }
      selectedEdges.push(item.edge);
    }
    const ids = new Set([query.nodeId]);
    for (const edge of selectedEdges) {
      ids.add(edge.from);
      ids.add(edge.to);
    }
    const nextCursor = truncationReason === "results" ? cursor + selectedEdges.length : null;
    return response(
      nodes.filter((node) => ids.has(node.id)),
      selectedEdges,
      null,
      nextCursor,
    );
  }

  if (query.type === "impact") {
    if (!nodeById.has(query.nodeId)) {
      charge();
      return response([], []);
    }
    const queue: { id: string; depth: number }[] = [{ id: query.nodeId, depth: 0 }];
    const visited = new Set([query.nodeId]);
    const selectedEdges: QueryGraphEdge[] = [];
    let cursor = 0;
    while (cursor < queue.length) {
      const current = queue[cursor++];
      if (current.depth >= query.maxDepth) continue;
      for (const item of sortedEdges) {
        if (!charge()) break;
        if (!permits(item.edge, current.id, query.direction, query.edgeKinds)) continue;
        const next = other(item.edge, current.id);
        if (visited.has(next)) continue;
        if (visited.size === query.budget.maxResults) {
          truncationReason = "results";
          break;
        }
        visited.add(next);
        selectedEdges.push(item.edge);
        queue.push({ id: next, depth: current.depth + 1 });
      }
      if (truncationReason) break;
    }
    return response(
      nodes.filter((node) => visited.has(node.id)),
      selectedEdges,
    );
  }

  if (!nodeById.has(query.from) || !nodeById.has(query.to)) {
    charge();
    return response([], []);
  }
  const queue: { id: string; depth: number }[] = [{ id: query.from, depth: 0 }];
  const visited = new Set([query.from]);
  const previous = new Map<string, { nodeId: string; edge: QueryGraphEdge }>();
  let cursor = 0;
  while (cursor < queue.length && !visited.has(query.to)) {
    const current = queue[cursor++];
    if (current.depth >= query.maxDepth) continue;
    for (const item of sortedEdges) {
      if (!charge()) break;
      if (!permits(item.edge, current.id, query.direction, query.edgeKinds)) continue;
      const next = other(item.edge, current.id);
      if (visited.has(next)) continue;
      visited.add(next);
      previous.set(next, { nodeId: current.id, edge: item.edge });
      queue.push({ id: next, depth: current.depth + 1 });
      if (next === query.to) break;
    }
    if (truncationReason) break;
  }
  if (!visited.has(query.to)) {
    return response([], []);
  }
  const path = [query.to];
  const pathEdges: QueryGraphEdge[] = [];
  while (path[0] !== query.from) {
    const step = previous.get(path[0])!;
    path.unshift(step.nodeId);
    pathEdges.unshift(step.edge);
  }
  return response(
    path.map((id) => nodeById.get(id)!),
    pathEdges,
    path,
  );
}

export function canonicalGraphJson(graph: CodeGraph): string {
  return JSON.stringify(canonicalizeCodeGraph(graph));
}
