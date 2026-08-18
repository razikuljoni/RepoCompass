import type {
  CodeGraph,
  CodeGraphV2,
  GraphEdgeKindV2,
  GraphNodeKindV2,
  GraphNodeV2,
  GraphLocationV2,
  GraphSnapshot,
} from "../domain/code-graph.ts";

export type NodeDiff = {
  id: string;
  kind: GraphNodeKindV2;
  name: string;
  location?: GraphLocationV2;
  change: "added" | "removed" | "modified";
  details?: string;
};

export type EdgeDiff = {
  id: string;
  from: string;
  to: string;
  kind: GraphEdgeKindV2;
  change: "added" | "removed";
};

export type GraphDiffSummary = {
  addedFiles: number;
  removedFiles: number;
  modifiedFiles: number;
  addedSymbols: number;
  removedSymbols: number;
  addedRoutes: number;
  removedRoutes: number;
  addedEdges: number;
  removedEdges: number;
  breakingWarnings: string[];
};

export type CodeGraphDiff = {
  baseSnapshot: GraphSnapshot;
  targetSnapshot: GraphSnapshot;
  summary: GraphDiffSummary;
  nodeDiffs: NodeDiff[];
  edgeDiffs: EdgeDiff[];
};

function v2(graph: CodeGraph): CodeGraphV2 | null {
  return graph.schemaVersion === "2.0" ? graph : null;
}

export function compareCodeGraphs(baseGraph: CodeGraph, targetGraph: CodeGraph): CodeGraphDiff {
  const base = v2(baseGraph);
  const target = v2(targetGraph);

  if (!base || !target) {
    throw new Error("Cross-snapshot graph diff requires CodeGraph v2.0 schema.");
  }

  const baseNodesByPath = new Map<string, GraphNodeV2>();
  for (const n of base.nodes) {
    const key = `${n.kind}:${n.location?.path || ""}:${n.name}`;
    baseNodesByPath.set(key, n);
  }

  const targetNodesByPath = new Map<string, GraphNodeV2>();
  for (const n of target.nodes) {
    const key = `${n.kind}:${n.location?.path || ""}:${n.name}`;
    targetNodesByPath.set(key, n);
  }

  const nodeDiffs: NodeDiff[] = [];
  const breakingWarnings: string[] = [];

  let addedFiles = 0;
  let removedFiles = 0;
  let modifiedFiles = 0;
  let addedSymbols = 0;
  let removedSymbols = 0;
  let addedRoutes = 0;
  let removedRoutes = 0;

  // Check target nodes against base
  for (const [key, node] of targetNodesByPath) {
    const baseNode = baseNodesByPath.get(key);
    if (!baseNode) {
      nodeDiffs.push({
        id: node.id,
        kind: node.kind,
        name: node.name,
        location: node.location,
        change: "added",
      });
      if (node.kind === "file") addedFiles++;
      else if (node.kind === "symbol") addedSymbols++;
      else if (node.kind === "route") addedRoutes++;
    } else {
      // Node exists in both
      if (node.kind === "file") modifiedFiles++;
    }
  }

  // Check base nodes removed in target
  for (const [key, node] of baseNodesByPath) {
    if (!targetNodesByPath.has(key)) {
      nodeDiffs.push({
        id: node.id,
        kind: node.kind,
        name: node.name,
        location: node.location,
        change: "removed",
      });
      if (node.kind === "file") removedFiles++;
      else if (node.kind === "symbol") {
        removedSymbols++;
        if (node.metadata && "exported" in node.metadata && node.metadata.exported) {
          breakingWarnings.push(
            `Exported symbol \`${node.name}\` in \`${node.location?.path || "unknown"}\` was removed.`,
          );
        }
      } else if (node.kind === "route") {
        removedRoutes++;
        breakingWarnings.push(`Route endpoint \`${node.name}\` was removed.`);
      }
    }
  }

  // Compare edges
  const baseEdgeKeys = new Set(base.edges.map((e) => `${e.from}->${e.to}:${e.kind}`));
  const targetEdgeKeys = new Set(target.edges.map((e) => `${e.from}->${e.to}:${e.kind}`));

  const edgeDiffs: EdgeDiff[] = [];
  let addedEdges = 0;
  let removedEdges = 0;

  for (const e of target.edges) {
    const key = `${e.from}->${e.to}:${e.kind}`;
    if (!baseEdgeKeys.has(key)) {
      addedEdges++;
      edgeDiffs.push({
        id: e.id,
        from: e.from,
        to: e.to,
        kind: e.kind,
        change: "added",
      });
    }
  }

  for (const e of base.edges) {
    const key = `${e.from}->${e.to}:${e.kind}`;
    if (!targetEdgeKeys.has(key)) {
      removedEdges++;
      edgeDiffs.push({
        id: e.id,
        from: e.from,
        to: e.to,
        kind: e.kind,
        change: "removed",
      });
    }
  }

  nodeDiffs.sort((a, b) => (a.change + a.kind + a.name).localeCompare(b.change + b.kind + b.name));
  edgeDiffs.sort((a, b) => (a.change + a.kind + a.from).localeCompare(b.change + b.kind + b.from));

  return {
    baseSnapshot: base.snapshot,
    targetSnapshot: target.snapshot,
    summary: {
      addedFiles,
      removedFiles,
      modifiedFiles,
      addedSymbols,
      removedSymbols,
      addedRoutes,
      removedRoutes,
      addedEdges,
      removedEdges,
      breakingWarnings,
    },
    nodeDiffs,
    edgeDiffs,
  };
}
