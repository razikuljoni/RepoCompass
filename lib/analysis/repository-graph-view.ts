import type { CodeGraph, GraphEdgeKindV2, GraphEdgeV2, GraphNodeV2 } from "../domain/code-graph.ts";

type FileRelationship = {
  edgeId: string;
  kind: GraphEdgeKindV2;
  direction: "incoming" | "outgoing";
  name: string;
  path?: string;
  line?: number;
};

export type FileGraphDetails = {
  symbols: GraphNodeV2[];
  routes: GraphNodeV2[];
  relationships: FileRelationship[];
};

export type ImpactedFile = {
  path: string;
  depth: number;
  kinds: GraphEdgeKindV2[];
};

const impactKinds = new Set<GraphEdgeKindV2>([
  "imports",
  "requires",
  "references",
  "calls",
  "tests",
]);

function v2(graph: CodeGraph) {
  return graph.schemaVersion === "2.0" ? graph : null;
}

export function fileGraphDetails(graph: CodeGraph | null, path: string): FileGraphDetails {
  const current = graph && v2(graph);
  if (!current) return { symbols: [], routes: [], relationships: [] };

  const nodes = new Map(current.nodes.map((node) => [node.id, node]));
  const owned = new Set(
    current.nodes.filter((node) => node.location?.path === path).map((node) => node.id),
  );
  const relationships = current.edges
    .flatMap((edge): FileRelationship[] => {
      const outgoing = owned.has(edge.from);
      const incoming = owned.has(edge.to);
      if (!outgoing && !incoming) return [];
      const other = nodes.get(outgoing ? edge.to : edge.from);
      if (!other || owned.has(other.id) || edge.kind === "contains" || edge.kind === "declares") {
        return [];
      }
      const evidence = edge.evidence[0];
      return [
        {
          edgeId: edge.id,
          kind: edge.kind,
          direction: outgoing ? "outgoing" : "incoming",
          name: other.name,
          path: other.location?.path,
          line: evidence?.startLine,
        },
      ];
    })
    .sort((a, b) =>
      [a.direction, a.kind, a.path || "", a.name, a.edgeId]
        .join("\0")
        .localeCompare([b.direction, b.kind, b.path || "", b.name, b.edgeId].join("\0")),
    );

  return {
    symbols: current.nodes.filter((node) => node.kind === "symbol" && node.location?.path === path),
    routes: current.nodes.filter((node) => node.kind === "route" && node.location?.path === path),
    relationships,
  };
}

export function impactedFiles(
  graph: CodeGraph | null,
  targetPath: string,
  maxDepth = 3,
  maxResults = 50,
): ImpactedFile[] {
  const current = graph && v2(graph);
  if (!current || maxDepth < 1 || maxResults < 1) return [];

  const pathIds = new Map<string, string[]>();
  for (const node of current.nodes) {
    const path = node.location?.path;
    if (path) pathIds.set(path, [...(pathIds.get(path) || []), node.id]);
  }
  const nodes = new Map(current.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, GraphEdgeV2[]>();
  for (const edge of current.edges) {
    if (!impactKinds.has(edge.kind)) continue;
    incoming.set(edge.to, [...(incoming.get(edge.to) || []), edge]);
  }

  const seenPaths = new Set([targetPath]);
  let frontier = new Set(pathIds.get(targetPath) || []);
  const results: ImpactedFile[] = [];
  for (let depth = 1; depth <= maxDepth && frontier.size && results.length < maxResults; depth++) {
    const found = new Map<string, Set<GraphEdgeKindV2>>();
    for (const id of [...frontier].sort()) {
      for (const edge of incoming.get(id) || []) {
        const source = nodes.get(edge.from);
        const path = source?.location?.path;
        if (!path || seenPaths.has(path)) continue;
        const kinds = found.get(path) || new Set<GraphEdgeKindV2>();
        kinds.add(edge.kind);
        found.set(path, kinds);
      }
    }
    const paths = [...found].sort(([a], [b]) => a.localeCompare(b));
    frontier = new Set<string>();
    for (const [path, kinds] of paths) {
      if (results.length >= maxResults) break;
      seenPaths.add(path);
      results.push({ path, depth, kinds: [...kinds].sort() });
      for (const id of pathIds.get(path) || []) frontier.add(id);
    }
  }
  return results;
}
