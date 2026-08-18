import type { CodeGraphV2, GraphEdgeV2, GraphNodeV2 } from "../domain/code-graph.ts";
import type { Edge, RouteInfo, SymbolInfo } from "../domain/repository-graph.ts";
import type { Model } from "../domain/repository-model.ts";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function filePath(node: GraphNodeV2 | undefined): string | undefined {
  if (!node || node.kind !== "file") return undefined;
  return node.metadata.path;
}

function legacyEdge(edge: GraphEdgeV2, nodes: ReadonlyMap<string, GraphNodeV2>): Edge | undefined {
  if (edge.kind !== "imports" && edge.kind !== "requires") return undefined;
  const from = filePath(nodes.get(edge.from));
  if (!from || !edge.metadata) return undefined;
  return {
    from,
    to: edge.metadata.specifier,
    kind: edge.kind === "requires" ? "require" : "import",
  };
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function codeGraphToModel(base: Model, graph: CodeGraphV2): Model {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = uniqueBy(
    graph.edges
      .map((edge) => legacyEdge(edge, nodes))
      .filter((edge): edge is Edge => Boolean(edge))
      .sort((left, right) =>
        compareText(
          `${left.from}\0${left.to}\0${left.kind}`,
          `${right.from}\0${right.to}\0${right.kind}`,
        ),
      ),
    (edge) => `${edge.from}\0${edge.to}\0${edge.kind}`,
  ).slice(0, 800);
  const symbols = graph.nodes
    .filter((node): node is Extract<GraphNodeV2, { kind: "symbol" }> => node.kind === "symbol")
    .filter((node) => Boolean(node.location))
    .map<SymbolInfo>((node) => ({
      name: node.name,
      kind: node.metadata.symbolKind,
      file: node.location!.path,
      line: node.location!.startLine ?? 1,
    }))
    .sort((left, right) =>
      compareText(
        `${left.file}\0${String(left.line).padStart(10, "0")}\0${left.name}\0${left.kind}`,
        `${right.file}\0${String(right.line).padStart(10, "0")}\0${right.name}\0${right.kind}`,
      ),
    )
    .slice(0, 1500);
  const routes = graph.nodes
    .filter((node): node is Extract<GraphNodeV2, { kind: "route" }> => node.kind === "route")
    .flatMap<RouteInfo>((node) =>
      node.metadata.methods.map((method) => ({
        method,
        path: node.metadata.path,
        file: node.location?.path ?? "",
      })),
    )
    .filter((route) => Boolean(route.file))
    .sort((left, right) =>
      compareText(
        `${left.file}\0${left.path}\0${left.method}`,
        `${right.file}\0${right.path}\0${right.method}`,
      ),
    )
    .slice(0, 300);
  const dependencies = uniqueBy(
    graph.edges
      .filter(
        (edge) =>
          (edge.kind === "imports" || edge.kind === "requires") &&
          edge.metadata?.resolution === "external",
      )
      .map((edge) => nodes.get(edge.to))
      .filter((node): node is Extract<GraphNodeV2, { kind: "package" }> => node?.kind === "package")
      .map((node) => node.metadata.packageName)
      .sort(compareText),
    (dependency) => dependency,
  );
  const sourceFiles = graph.nodes
    .filter((node): node is Extract<GraphNodeV2, { kind: "file" }> => node.kind === "file")
    .map((node) => node.metadata.path)
    .sort(compareText);

  return {
    ...base,
    sourceFiles,
    edges,
    symbols,
    routes,
    dependencies,
  };
}
