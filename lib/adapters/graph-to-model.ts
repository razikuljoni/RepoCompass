import type { RepositoryGraph } from "../domain/repository-graph.ts";
import type { Model } from "../domain/repository-model.ts";

export function graphToModel(base: Model, graph: RepositoryGraph): Model {
  const security = [...base.security, ...graph.security];
  return {
    ...base,
    edges: graph.edges.slice(0, 800),
    symbols: graph.symbols.slice(0, 1500),
    routes: graph.routes.slice(0, 300),
    dependencies: [...graph.dependencies].sort(),
    terms: graph.terms,
    security: security.filter(
      (finding, index, all) =>
        all.findIndex(
          (candidate) => candidate.title === finding.title && candidate.file === finding.file,
        ) === index,
    ),
  };
}
