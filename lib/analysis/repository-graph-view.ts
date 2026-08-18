import type {
  CodeGraph,
  GraphDiagnostic,
  GraphEdgeKindV2,
  GraphEdgeV2,
  GraphNodeV2,
} from "../domain/code-graph.ts";

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

export type GraphDiagnostics = {
  syntaxErrors: number;
  unresolvedImports: number;
  unsupportedFiles: number;
};

export type GraphCoverage = {
  totalFiles: number;
  analyzedFiles: number;
  skippedFiles: number;
  truncated: boolean;
};

export type GraphHealth = {
  diagnostics: GraphDiagnostics;
  coverage: GraphCoverage;
  healthScore: number;
};

const syntaxPattern = /SYNTAX|PARSE|PARSE_ERROR|UNSUPPORTED_SYNTAX/i;
const importPattern = /IMPORT|UNRESOLVED|MISSING_MODULE|MODULE_NOT_FOUND/i;
const unsupportedPattern = /UNSUPPORTED|UNSUPPORTED_FILE|FILE_TYPE/i;

function countDiagnostic(
  diagnostics: GraphDiagnostic[],
  kind: "syntax" | "import" | "unsupported",
): number {
  const pattern =
    kind === "syntax" ? syntaxPattern : kind === "import" ? importPattern : unsupportedPattern;
  return diagnostics.filter((d) => pattern.test(d.code)).length;
}

export function overviewGraphHealth(graph: CodeGraph): GraphHealth | null {
  if (graph.schemaVersion !== "2.0") return null;

  const { diagnostics, coverage } = graph;
  const syntaxErrors = countDiagnostic(diagnostics, "syntax");
  const unresolvedImports = countDiagnostic(diagnostics, "import");
  const unsupportedFiles = countDiagnostic(diagnostics, "unsupported");

  const skippedFiles = coverage.totalFiles - coverage.analyzedFiles;

  let score = 0;
  if (syntaxErrors === 0) score += 40;
  const unresolvedPct = coverage.totalFiles > 0 ? unresolvedImports / coverage.totalFiles : 0;
  if (unresolvedPct < 0.05) score += 30;
  if (skippedFiles === 0) score += 20;
  if (!coverage.truncated) score += 10;

  return {
    diagnostics: { syntaxErrors, unresolvedImports, unsupportedFiles },
    coverage: {
      totalFiles: coverage.totalFiles,
      analyzedFiles: coverage.analyzedFiles,
      skippedFiles,
      truncated: coverage.truncated,
    },
    healthScore: score,
  };
}

export type DirectoryFlow = {
  fromDir: string;
  toDir: string;
  count: number;
};

export type HubModule = {
  path: string;
  fanIn: number;
  fanOut: number;
  total: number;
};

export type ArchitectureSummary = {
  topDirectories: { name: string; fileCount: number; fanIn: number; fanOut: number }[];
  hubs: HubModule[];
  flows: DirectoryFlow[];
};

export function architectureGraphSummary(graph: CodeGraph | null): ArchitectureSummary | null {
  const current = graph && v2(graph);
  if (!current) return null;

  const nodePath = new Map<string, string>();
  for (const node of current.nodes) {
    if (node.location?.path) nodePath.set(node.id, node.location.path);
  }

  const fileFanIn = new Map<string, number>();
  const fileFanOut = new Map<string, number>();

  const dirFanIn = new Map<string, number>();
  const dirFanOut = new Map<string, number>();
  const dirFiles = new Map<string, Set<string>>();
  const flowCounts = new Map<string, number>();

  for (const node of current.nodes) {
    const p = node.location?.path;
    if (!p) continue;
    const dir = p.includes("/") ? p.split("/")[0] : ".";
    if (!dirFiles.has(dir)) dirFiles.set(dir, new Set());
    dirFiles.get(dir)!.add(p);
  }

  for (const edge of current.edges) {
    if (edge.kind === "contains" || edge.kind === "declares") continue;
    const fromP = nodePath.get(edge.from);
    const toP = nodePath.get(edge.to);
    if (!fromP || !toP || fromP === toP) continue;

    fileFanOut.set(fromP, (fileFanOut.get(fromP) || 0) + 1);
    fileFanIn.set(toP, (fileFanIn.get(toP) || 0) + 1);

    const fromDir = fromP.includes("/") ? fromP.split("/")[0] : ".";
    const toDir = toP.includes("/") ? toP.split("/")[0] : ".";

    if (fromDir !== toDir) {
      dirFanOut.set(fromDir, (dirFanOut.get(fromDir) || 0) + 1);
      dirFanIn.set(toDir, (dirFanIn.get(toDir) || 0) + 1);

      const key = `${fromDir}->${toDir}`;
      flowCounts.set(key, (flowCounts.get(key) || 0) + 1);
    }
  }

  const topDirectories = [...dirFiles.entries()]
    .map(([name, files]) => ({
      name,
      fileCount: files.size,
      fanIn: dirFanIn.get(name) || 0,
      fanOut: dirFanOut.get(name) || 0,
    }))
    .sort((a, b) => b.fileCount - a.fileCount);

  const allFiles = new Set([...fileFanIn.keys(), ...fileFanOut.keys()]);
  const hubs: HubModule[] = [...allFiles]
    .map((p) => {
      const fi = fileFanIn.get(p) || 0;
      const fo = fileFanOut.get(p) || 0;
      return { path: p, fanIn: fi, fanOut: fo, total: fi + fo };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const flows: DirectoryFlow[] = [...flowCounts.entries()]
    .map(([key, count]) => {
      const [fromDir, toDir] = key.split("->");
      return { fromDir, toDir, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  return { topDirectories, hubs, flows };
}

export function findRelatedGraphNodes(graph: CodeGraph | null, filePath?: string): GraphNodeV2[] {
  const current = graph && v2(graph);
  if (!current || !filePath) return [];
  return current.nodes.filter((node) => node.location?.path === filePath);
}
