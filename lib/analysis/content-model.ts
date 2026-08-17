import { graphToModel } from "../adapters/graph-to-model.ts";
import type { Repo } from "../domain/repository.ts";
import type { Model } from "../domain/repository-model.ts";
import { buildRepositoryGraph } from "./build-repository-graph.ts";
import { buildModel } from "./build-repository-model.ts";

export function contentModel(repo: Repo): Model {
  return graphToModel(buildModel(repo), buildRepositoryGraph(repo));
}
