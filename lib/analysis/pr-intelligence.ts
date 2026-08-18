import type { CodeGraph, GraphEdgeKindV2, GraphEdgeV2, GraphNodeV2 } from "../domain/code-graph";

export type PRFileChange = {
  path: string;
  status: "added" | "modified" | "deleted";
  additions?: number;
  deletions?: number;
};

export type TransitiveImpact = {
  nodeId: string;
  kind: string;
  name: string;
  path?: string;
  distance: number;
  viaEdgeKind: GraphEdgeKindV2;
};

export type RiskFactor = {
  title: string;
  score: number;
  reason: string;
};

export type PRImpactReport = {
  summary: string;
  changedFiles: number;
  directlyAffectedNodeCount: number;
  transitiveImpactCount: number;
  affectedRoutes: { id: string; name: string; path?: string; methods?: string[] }[];
  affectedTests: { id: string; name: string; path?: string }[];
  affectedSchemas: { id: string; name: string; path?: string }[];
  affectedPublicExports: { id: string; name: string; path?: string; symbolKind?: string }[];
  transitiveImpacts: TransitiveImpact[];
  riskScore: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  riskFactors: RiskFactor[];
};

export function analyzePRImpact(graph: CodeGraph, changes: PRFileChange[]): PRImpactReport {
  if (graph.schemaVersion !== "2.0") {
    return {
      summary: "PR impact analysis requires CodeGraph v2.0",
      changedFiles: changes.length,
      directlyAffectedNodeCount: 0,
      transitiveImpactCount: 0,
      affectedRoutes: [],
      affectedTests: [],
      affectedSchemas: [],
      affectedPublicExports: [],
      transitiveImpacts: [],
      riskScore: 0,
      riskLevel: "low",
      riskFactors: [],
    };
  }

  const changedPaths = new Set(changes.map((c) => c.path));
  const nodeMap = new Map<string, GraphNodeV2>(graph.nodes.map((n) => [n.id, n]));

  // Find directly affected nodes (nodes located in changed files)
  const directNodes = graph.nodes.filter(
    (node) => node.location && changedPaths.has(node.location.path),
  );
  const directNodeIds = new Set(directNodes.map((n) => n.id));

  // Build incoming adjacency map for reverse impact traversal
  const incomingMap = new Map<string, GraphEdgeV2[]>();
  for (const edge of graph.edges) {
    const list = incomingMap.get(edge.to) || [];
    list.push(edge);
    incomingMap.set(edge.to, list);
  }

  // Perform BFS to find transitive impact (up to depth 4)
  const transitiveImpacts: TransitiveImpact[] = [];
  const visitedNodeIds = new Set<string>(directNodeIds);
  const queue: { id: string; distance: number }[] = Array.from(directNodeIds).map((id) => ({
    id,
    distance: 0,
  }));

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.distance >= 4) continue;

    const edges = incomingMap.get(current.id) || [];
    for (const edge of edges) {
      if (visitedNodeIds.has(edge.from)) continue;

      // Skip containment/declaration edges for transitive impact
      if (edge.kind === "contains" || edge.kind === "declares") continue;

      visitedNodeIds.add(edge.from);
      const sourceNode = nodeMap.get(edge.from);
      if (sourceNode) {
        transitiveImpacts.push({
          nodeId: sourceNode.id,
          kind: sourceNode.kind,
          name: sourceNode.name,
          path: sourceNode.location?.path,
          distance: current.distance + 1,
          viaEdgeKind: edge.kind,
        });

        queue.push({ id: sourceNode.id, distance: current.distance + 1 });
      }
    }
  }

  // Identify affected routes
  const affectedRoutesMap = new Map<
    string,
    { id: string; name: string; path?: string; methods?: string[] }
  >();
  for (const node of graph.nodes) {
    if (node.kind === "route" && visitedNodeIds.has(node.id)) {
      affectedRoutesMap.set(node.id, {
        id: node.id,
        name: node.name,
        path: node.location?.path,
        methods: "methods" in node.metadata ? node.metadata.methods : undefined,
      });
    }
  }
  const affectedRoutes = Array.from(affectedRoutesMap.values());

  // Identify affected tests
  const affectedTestsMap = new Map<string, { id: string; name: string; path?: string }>();
  for (const node of graph.nodes) {
    if (
      (node.kind === "symbol" && node.name.toLowerCase().includes("test")) ||
      (node.location?.path.includes("test") && visitedNodeIds.has(node.id))
    ) {
      affectedTestsMap.set(node.id, {
        id: node.id,
        name: node.name,
        path: node.location?.path,
      });
    }
  }
  const affectedTests = Array.from(affectedTestsMap.values());

  // Identify affected schemas
  const affectedSchemasMap = new Map<string, { id: string; name: string; path?: string }>();
  for (const node of graph.nodes) {
    if (node.kind === "schema" && visitedNodeIds.has(node.id)) {
      affectedSchemasMap.set(node.id, {
        id: node.id,
        name: node.name,
        path: node.location?.path,
      });
    }
  }
  const affectedSchemas = Array.from(affectedSchemasMap.values());

  // Identify affected public exports
  const affectedPublicExports: { id: string; name: string; path?: string; symbolKind?: string }[] =
    [];
  for (const node of directNodes) {
    if (node.kind === "symbol" && "exported" in node.metadata && node.metadata.exported) {
      affectedPublicExports.push({
        id: node.id,
        name: node.name,
        path: node.location?.path,
        symbolKind: node.metadata.symbolKind,
      });
    }
  }

  // Calculate Risk Score and Risk Factors
  const riskFactors: RiskFactor[] = [];
  let score = 0;

  // Factor 1: Scope of file changes
  if (changes.length > 15) {
    riskFactors.push({
      title: "Large PR Scope",
      score: 25,
      reason: `${changes.length} files modified in PR`,
    });
    score += 25;
  } else if (changes.length > 5) {
    riskFactors.push({
      title: "Moderate PR Scope",
      score: 15,
      reason: `${changes.length} files modified in PR`,
    });
    score += 15;
  }

  // Factor 2: Deletions/destructions
  const deletedFiles = changes.filter((c) => c.status === "deleted");
  if (deletedFiles.length > 0) {
    const pts = Math.min(deletedFiles.length * 10, 30);
    riskFactors.push({
      title: "File Deletions",
      score: pts,
      reason: `${deletedFiles.length} file(s) deleted: ${deletedFiles
        .map((f) => f.path)
        .slice(0, 3)
        .join(", ")}`,
    });
    score += pts;
  }

  // Factor 3: Public API / Export changes
  if (affectedPublicExports.length > 0) {
    const pts = Math.min(affectedPublicExports.length * 10, 30);
    riskFactors.push({
      title: "Exported Interface Changes",
      score: pts,
      reason: `${affectedPublicExports.length} exported symbol(s) modified`,
    });
    score += pts;
  }

  // Factor 4: Affected Routes
  if (affectedRoutes.length > 0) {
    const pts = Math.min(affectedRoutes.length * 15, 30);
    riskFactors.push({
      title: "API Endpoint Impact",
      score: pts,
      reason: `${affectedRoutes.length} HTTP route(s) in blast radius`,
    });
    score += pts;
  }

  // Factor 5: Transitive Blast Radius size
  if (transitiveImpacts.length > 20) {
    riskFactors.push({
      title: "High Transitive Blast Radius",
      score: 20,
      reason: `${transitiveImpacts.length} dependent graph nodes impacted`,
    });
    score += 20;
  } else if (transitiveImpacts.length > 5) {
    riskFactors.push({
      title: "Moderate Blast Radius",
      score: 10,
      reason: `${transitiveImpacts.length} dependent graph nodes impacted`,
    });
    score += 10;
  }

  const finalScore = Math.min(score, 100);
  let riskLevel: "low" | "medium" | "high" | "critical" = "low";
  if (finalScore >= 70) riskLevel = "critical";
  else if (finalScore >= 45) riskLevel = "high";
  else if (finalScore >= 20) riskLevel = "medium";

  const summary = `PR touches ${changes.length} file(s) impacting ${directNodes.length} direct node(s) and ${transitiveImpacts.length} transitive node(s). ${affectedRoutes.length} route(s) and ${affectedPublicExports.length} public export(s) affected. Risk score: ${finalScore}/100 (${riskLevel.toUpperCase()}).`;

  return {
    summary,
    changedFiles: changes.length,
    directlyAffectedNodeCount: directNodes.length,
    transitiveImpactCount: transitiveImpacts.length,
    affectedRoutes,
    affectedTests,
    affectedSchemas,
    affectedPublicExports,
    transitiveImpacts,
    riskScore: finalScore,
    riskLevel,
    riskFactors,
  };
}
