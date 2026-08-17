import {
  graphEdgeKinds,
  graphNodeKinds,
  graphProvenanceKinds,
  graphSchemaVersion,
  type CodeGraph,
  type GraphEdge,
  type GraphEvidence,
  type GraphLocation,
  type GraphNode,
  type GraphSnapshot,
} from "../domain/code-graph.ts";

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : string(value, path);
}

function positiveInteger(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new TypeError(`${path} must be a positive integer`);
  }
  return value as number;
}

function location(value: unknown, path: string): GraphLocation {
  const input = record(value, path);
  const result: GraphLocation = {
    path: string(input.path, `${path}.path`),
  };
  const startLine = positiveInteger(input.startLine, `${path}.startLine`);
  const endLine = positiveInteger(input.endLine, `${path}.endLine`);
  if (startLine !== undefined) result.startLine = startLine;
  if (endLine !== undefined) result.endLine = endLine;
  if (startLine !== undefined && endLine !== undefined && endLine < startLine) {
    throw new TypeError(`${path}.endLine must be greater than or equal to startLine`);
  }
  return result;
}

function node(value: unknown, path: string): GraphNode {
  const input = record(value, path);
  const kind = string(input.kind, `${path}.kind`);
  if (!graphNodeKinds.includes(kind as GraphNode["kind"])) {
    throw new TypeError(`${path}.kind is not supported`);
  }
  const result: GraphNode = {
    id: string(input.id, `${path}.id`),
    kind: kind as GraphNode["kind"],
    name: string(input.name, `${path}.name`),
  };
  if (input.location !== undefined) result.location = location(input.location, `${path}.location`);
  const language = optionalString(input.language, `${path}.language`);
  if (language !== undefined) result.language = language;
  return result;
}

function evidence(value: unknown, path: string): GraphEvidence {
  const input = record(value, path);
  const result: GraphEvidence = location(input, path);
  const excerptHash = optionalString(input.excerptHash, `${path}.excerptHash`);
  if (excerptHash !== undefined) result.excerptHash = excerptHash;
  return result;
}

function edge(value: unknown, path: string): GraphEdge {
  const input = record(value, path);
  const kind = string(input.kind, `${path}.kind`);
  const provenance = string(input.provenance, `${path}.provenance`);
  if (!graphEdgeKinds.includes(kind as GraphEdge["kind"])) {
    throw new TypeError(`${path}.kind is not supported`);
  }
  if (!graphProvenanceKinds.includes(provenance as GraphEdge["provenance"])) {
    throw new TypeError(`${path}.provenance is not supported`);
  }
  if (!Array.isArray(input.evidence)) throw new TypeError(`${path}.evidence must be an array`);
  const result: GraphEdge = {
    from: string(input.from, `${path}.from`),
    to: string(input.to, `${path}.to`),
    kind: kind as GraphEdge["kind"],
    provenance: provenance as GraphEdge["provenance"],
    evidence: input.evidence.map((item, index) => evidence(item, `${path}.evidence[${index}]`)),
  };
  if (input.confidence !== undefined) {
    if (
      typeof input.confidence !== "number" ||
      !Number.isFinite(input.confidence) ||
      input.confidence < 0 ||
      input.confidence > 1
    ) {
      throw new TypeError(`${path}.confidence must be a number between 0 and 1`);
    }
    result.confidence = input.confidence;
  }
  return result;
}

function snapshot(value: unknown): GraphSnapshot {
  const input = record(value, "snapshot");
  return {
    repositoryId: string(input.repositoryId, "snapshot.repositoryId"),
    commitSha: string(input.commitSha, "snapshot.commitSha"),
    ref: string(input.ref, "snapshot.ref"),
  };
}

export function parseCodeGraph(value: unknown): CodeGraph {
  const input = record(value, "graph");
  if (input.schemaVersion !== graphSchemaVersion) {
    throw new TypeError(`graph.schemaVersion must be "${graphSchemaVersion}"`);
  }
  if (!Array.isArray(input.nodes)) throw new TypeError("graph.nodes must be an array");
  if (!Array.isArray(input.edges)) throw new TypeError("graph.edges must be an array");
  const graph: CodeGraph = {
    schemaVersion: graphSchemaVersion,
    snapshot: snapshot(input.snapshot),
    nodes: input.nodes.map((item, index) => node(item, `nodes[${index}]`)),
    edges: input.edges.map((item, index) => edge(item, `edges[${index}]`)),
  };
  const nodeIds = new Set(graph.nodes.map((item) => item.id));
  if (nodeIds.size !== graph.nodes.length)
    throw new TypeError("graph.nodes contains duplicate ids");
  for (const [index, item] of graph.edges.entries()) {
    if (!nodeIds.has(item.from))
      throw new TypeError(`edges[${index}].from references an unknown node`);
    if (!nodeIds.has(item.to)) throw new TypeError(`edges[${index}].to references an unknown node`);
  }
  return graph;
}
