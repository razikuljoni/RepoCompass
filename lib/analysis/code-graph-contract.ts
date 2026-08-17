import {
  codeGraphLimits,
  graphDiagnosticSeverities,
  graphEdgeKinds,
  graphEdgeKindsV2,
  graphImportModes,
  graphNodeKinds,
  graphNodeKindsV2,
  graphProvenanceKinds,
  graphResolutionKinds,
  graphSchemaVersion,
  graphSchemaVersionV2,
  type CodeGraph,
  type CodeGraphCoverage,
  type CodeGraphLimits,
  type CodeGraphMetrics,
  type CodeGraphV1,
  type CodeGraphV2,
  type GraphDiagnostic,
  type GraphEdge,
  type GraphEdgeV2,
  type GraphEvidence,
  type GraphEvidenceV2,
  type GraphImportMetadata,
  type GraphLocation,
  type GraphLocationV2,
  type GraphNode,
  type GraphNodeV2,
} from "../domain/code-graph.ts";
import {
  parseRepositorySnapshot,
  parseSafeRepositoryPath,
  sha256Pattern,
} from "../domain/repository-snapshot.ts";

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  input: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(input).find((key) => !allowed.has(key));
  if (unknown) throw new TypeError(`${path}.${unknown} is not allowed`);
  const missing = required.find((key) => !Object.hasOwn(input, key));
  if (missing) throw new TypeError(`${path}.${missing} is required`);
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value;
}

function strictString(value: unknown, path: string): string {
  const result = string(value, path);
  if (result !== result.trim() || /[\u0000-\u001f\u007f]/.test(result)) {
    throw new TypeError(`${path} must not contain surrounding whitespace or control characters`);
  }
  return result;
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : string(value, path);
}

function positiveInteger(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${path} must be a positive integer`);
  }
  return value as number;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer`);
  }
  return value as number;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number`);
  }
  return value;
}

function confidence(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  const result = finiteNumber(value, path);
  if (result < 0 || result > 1) throw new TypeError(`${path} must be a number between 0 and 1`);
  return result;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${path} must be a boolean`);
  return value;
}

function stringArray(value: unknown, path: string, limit?: number): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  if (limit !== undefined && value.length > limit) throw new TypeError(`${path} exceeds its limit`);
  return value.map((item, index) => strictString(item, `${path}[${index}]`));
}

function location(value: unknown, path: string): GraphLocation {
  const input = record(value, path);
  const result: GraphLocation = { path: string(input.path, `${path}.path`) };
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
  const parsedConfidence = confidence(input.confidence, `${path}.confidence`);
  if (parsedConfidence !== undefined) result.confidence = parsedConfidence;
  return result;
}

function parseV1(input: Record<string, unknown>): CodeGraphV1 {
  if (!Array.isArray(input.nodes)) throw new TypeError("graph.nodes must be an array");
  if (!Array.isArray(input.edges)) throw new TypeError("graph.edges must be an array");
  const graph: CodeGraphV1 = {
    schemaVersion: graphSchemaVersion,
    snapshot: parseRepositorySnapshot(input.snapshot),
    nodes: input.nodes.map((item, index) => node(item, `nodes[${index}]`)),
    edges: input.edges.map((item, index) => edge(item, `edges[${index}]`)),
  };
  validateEndpoints(graph.nodes, graph.edges);
  return graph;
}

function locationV2(value: unknown, path: string, manifestPaths: Set<string>): GraphLocationV2 {
  const input = record(value, path);
  exactKeys(input, ["path"], ["startLine", "startColumn", "endLine", "endColumn"], path);
  const result: GraphLocationV2 = {
    path: parseSafeRepositoryPath(input.path, `${path}.path`),
  };
  if (!manifestPaths.has(result.path))
    throw new TypeError(`${path}.path is not in snapshot.manifest`);
  const startLine = positiveInteger(input.startLine, `${path}.startLine`);
  const startColumn = positiveInteger(input.startColumn, `${path}.startColumn`);
  const endLine = positiveInteger(input.endLine, `${path}.endLine`);
  const endColumn = positiveInteger(input.endColumn, `${path}.endColumn`);
  if ((startColumn !== undefined || endColumn !== undefined) && startLine === undefined) {
    throw new TypeError(`${path}.startLine is required when columns are present`);
  }
  if (endColumn !== undefined && endLine === undefined) {
    throw new TypeError(`${path}.endLine is required when endColumn is present`);
  }
  if (endLine !== undefined && startLine === undefined) {
    throw new TypeError(`${path}.startLine is required when endLine is present`);
  }
  if (startLine !== undefined) result.startLine = startLine;
  if (startColumn !== undefined) result.startColumn = startColumn;
  if (endLine !== undefined) result.endLine = endLine;
  if (endColumn !== undefined) result.endColumn = endColumn;
  if (startLine !== undefined && endLine !== undefined) {
    if (
      endLine < startLine ||
      (endLine === startLine && endColumn !== undefined && endColumn < (startColumn ?? 1))
    ) {
      throw new TypeError(`${path} end position must not precede start position`);
    }
  }
  return result;
}

function optionalStrictString(
  input: Record<string, unknown>,
  key: string,
  path: string,
): string | undefined {
  return input[key] === undefined ? undefined : strictString(input[key], `${path}.${key}`);
}

function metadataV2(
  kind: GraphNodeV2["kind"],
  value: unknown,
  path: string,
  manifestPaths: Set<string>,
): GraphNodeV2["metadata"] {
  const input = record(value, path);
  if (kind === "file") {
    exactKeys(input, ["path"], ["language", "sizeBytes", "contentSha256", "module"], path);
    const result: Extract<GraphNodeV2, { kind: "file" }>["metadata"] = {
      path: parseSafeRepositoryPath(input.path, `${path}.path`),
    };
    if (!manifestPaths.has(result.path))
      throw new TypeError(`${path}.path is not in snapshot.manifest`);
    const language = optionalStrictString(input, "language", path);
    const moduleName = optionalStrictString(input, "module", path);
    if (language !== undefined) result.language = language;
    if (moduleName !== undefined) result.module = moduleName;
    if (input.sizeBytes !== undefined)
      result.sizeBytes = nonNegativeInteger(input.sizeBytes, `${path}.sizeBytes`);
    if (input.contentSha256 !== undefined) {
      const hash = strictString(input.contentSha256, `${path}.contentSha256`);
      if (!sha256Pattern.test(hash))
        throw new TypeError(
          `${path}.contentSha256 must be a lowercase 64-character SHA-256 digest`,
        );
      result.contentSha256 = hash;
    }
    return result;
  }
  if (kind === "symbol") {
    exactKeys(
      input,
      ["symbolKind"],
      ["qualifiedName", "signature", "visibility", "exported", "async"],
      path,
    );
    const result: Extract<GraphNodeV2, { kind: "symbol" }>["metadata"] = {
      symbolKind: strictString(input.symbolKind, `${path}.symbolKind`),
    };
    const qualifiedName = optionalStrictString(input, "qualifiedName", path);
    const signature = optionalStrictString(input, "signature", path);
    if (qualifiedName !== undefined) result.qualifiedName = qualifiedName;
    if (signature !== undefined) result.signature = signature;
    if (input.visibility !== undefined) {
      const visibility = strictString(input.visibility, `${path}.visibility`);
      if (!["public", "protected", "private", "internal"].includes(visibility))
        throw new TypeError(`${path}.visibility is not supported`);
      result.visibility = visibility as typeof result.visibility;
    }
    if (input.exported !== undefined) result.exported = boolean(input.exported, `${path}.exported`);
    if (input.async !== undefined) result.async = boolean(input.async, `${path}.async`);
    return result;
  }
  if (kind === "package") {
    exactKeys(input, ["packageName"], ["version", "manager", "workspacePath"], path);
    const result: Extract<GraphNodeV2, { kind: "package" }>["metadata"] = {
      packageName: strictString(input.packageName, `${path}.packageName`),
    };
    for (const key of ["version", "manager"] as const) {
      const item = optionalStrictString(input, key, path);
      if (item !== undefined) result[key] = item;
    }
    if (input.workspacePath !== undefined)
      result.workspacePath = parseSafeRepositoryPath(input.workspacePath, `${path}.workspacePath`);
    return result;
  }
  if (kind === "route") {
    exactKeys(input, ["path", "methods"], ["framework"], path);
    const result: Extract<GraphNodeV2, { kind: "route" }>["metadata"] = {
      path: strictString(input.path, `${path}.path`),
      methods: stringArray(input.methods, `${path}.methods`),
    };
    const framework = optionalStrictString(input, "framework", path);
    if (framework !== undefined) result.framework = framework;
    return result;
  }
  exactKeys(input, ["schemaKind"], ["qualifiedName", "fields"], path);
  const result: Extract<GraphNodeV2, { kind: "schema" }>["metadata"] = {
    schemaKind: strictString(input.schemaKind, `${path}.schemaKind`),
  };
  const qualifiedName = optionalStrictString(input, "qualifiedName", path);
  if (qualifiedName !== undefined) result.qualifiedName = qualifiedName;
  if (input.fields !== undefined) result.fields = stringArray(input.fields, `${path}.fields`);
  return result;
}

function nodeV2(value: unknown, path: string, manifestPaths: Set<string>): GraphNodeV2 {
  const input = record(value, path);
  exactKeys(input, ["id", "kind", "name", "metadata"], ["location"], path);
  const kind = strictString(input.kind, `${path}.kind`);
  if (!graphNodeKindsV2.includes(kind as GraphNodeV2["kind"]))
    throw new TypeError(`${path}.kind is not supported`);
  const base = {
    id: strictString(input.id, `${path}.id`),
    kind: kind as GraphNodeV2["kind"],
    name: strictString(input.name, `${path}.name`),
    metadata: metadataV2(
      kind as GraphNodeV2["kind"],
      input.metadata,
      `${path}.metadata`,
      manifestPaths,
    ),
  };
  return {
    ...base,
    ...(input.location === undefined
      ? {}
      : { location: locationV2(input.location, `${path}.location`, manifestPaths) }),
  } as GraphNodeV2;
}

function evidenceV2(value: unknown, path: string, manifestPaths: Set<string>): GraphEvidenceV2 {
  const input = record(value, path);
  exactKeys(
    input,
    ["path"],
    ["startLine", "startColumn", "endLine", "endColumn", "excerptHash", "description"],
    path,
  );
  const result: GraphEvidenceV2 = locationV2(input, path, manifestPaths);
  if (result.startLine === undefined) throw new TypeError(`${path}.startLine is required`);
  const excerptHash = optionalStrictString(input, "excerptHash", path);
  const description = optionalStrictString(input, "description", path);
  if (excerptHash !== undefined) {
    if (!sha256Pattern.test(excerptHash))
      throw new TypeError(`${path}.excerptHash must be a lowercase 64-character SHA-256 digest`);
    result.excerptHash = excerptHash;
  }
  if (description !== undefined) result.description = description;
  return result;
}

function importMetadata(value: unknown, path: string): GraphImportMetadata {
  const input = record(value, path);
  exactKeys(input, ["mode", "specifier", "typeOnly", "resolution", "candidates"], [], path);
  const mode = strictString(input.mode, `${path}.mode`);
  const resolution = strictString(input.resolution, `${path}.resolution`);
  if (!graphImportModes.includes(mode as GraphImportMetadata["mode"]))
    throw new TypeError(`${path}.mode is not supported`);
  if (!graphResolutionKinds.includes(resolution as GraphImportMetadata["resolution"]))
    throw new TypeError(`${path}.resolution is not supported`);
  const result: GraphImportMetadata = {
    mode: mode as GraphImportMetadata["mode"],
    specifier: strictString(input.specifier, `${path}.specifier`),
    typeOnly: boolean(input.typeOnly, `${path}.typeOnly`),
    resolution: resolution as GraphImportMetadata["resolution"],
    candidates: stringArray(
      input.candidates,
      `${path}.candidates`,
      codeGraphLimits.maxCandidatesPerEdge,
    ),
  };
  if (result.mode === "type" && !result.typeOnly)
    throw new TypeError(`${path}.typeOnly must be true for type imports`);
  if (result.resolution === "ambiguous" && result.candidates.length < 2)
    throw new TypeError(
      `${path}.candidates must contain at least two candidates for ambiguous resolution`,
    );
  if (result.resolution === "unresolved" && result.candidates.length !== 0)
    throw new TypeError(`${path}.candidates must be empty for unresolved resolution`);
  return result;
}

function edgeV2(value: unknown, path: string, manifestPaths: Set<string>): GraphEdgeV2 {
  const input = record(value, path);
  exactKeys(
    input,
    ["id", "from", "to", "kind", "provenance", "evidence"],
    ["confidence", "metadata"],
    path,
  );
  const kind = strictString(input.kind, `${path}.kind`);
  const provenance = strictString(input.provenance, `${path}.provenance`);
  if (!graphEdgeKindsV2.includes(kind as GraphEdgeV2["kind"]))
    throw new TypeError(`${path}.kind is not supported`);
  if (!graphProvenanceKinds.includes(provenance as GraphEdgeV2["provenance"]))
    throw new TypeError(`${path}.provenance is not supported`);
  if (!Array.isArray(input.evidence)) throw new TypeError(`${path}.evidence must be an array`);
  if (input.evidence.length > codeGraphLimits.maxEvidencePerEdge)
    throw new TypeError(`${path}.evidence exceeds limits.maxEvidencePerEdge`);
  const parsedConfidence = confidence(input.confidence, `${path}.confidence`);
  const result: GraphEdgeV2 = {
    id: strictString(input.id, `${path}.id`),
    from: strictString(input.from, `${path}.from`),
    to: strictString(input.to, `${path}.to`),
    kind: kind as GraphEdgeV2["kind"],
    provenance: provenance as GraphEdgeV2["provenance"],
    evidence: input.evidence.map((item, index) =>
      evidenceV2(item, `${path}.evidence[${index}]`, manifestPaths),
    ),
  };
  if (parsedConfidence !== undefined) result.confidence = parsedConfidence;
  if (kind === "imports" || kind === "requires") {
    if (input.metadata === undefined)
      throw new TypeError(`${path}.metadata is required for ${kind} edges`);
    result.metadata = importMetadata(input.metadata, `${path}.metadata`);
  } else if (input.metadata !== undefined) {
    throw new TypeError(`${path}.metadata is only allowed for import edges`);
  }
  if (provenance === "EXTRACTED") {
    if (result.evidence.length === 0)
      throw new TypeError(`${path}.evidence must not be empty for EXTRACTED provenance`);
    if (parsedConfidence !== undefined && parsedConfidence !== 1)
      throw new TypeError(`${path}.confidence must be 1 for EXTRACTED provenance`);
  } else if (parsedConfidence === undefined || parsedConfidence === 1) {
    throw new TypeError(`${path}.confidence must be less than 1 for ${provenance} provenance`);
  }
  if (provenance === "AMBIGUOUS" && result.metadata?.resolution !== "ambiguous") {
    throw new TypeError(`${path}.metadata.resolution must be ambiguous for AMBIGUOUS provenance`);
  }
  return result;
}

function limitsV2(value: unknown, path: string): CodeGraphLimits {
  const input = record(value, path);
  const keys = Object.keys(codeGraphLimits) as (keyof CodeGraphLimits)[];
  exactKeys(input, keys, [], path);
  for (const key of keys)
    if (input[key] !== codeGraphLimits[key])
      throw new TypeError(`${path}.${key} must be ${codeGraphLimits[key]}`);
  return { ...codeGraphLimits };
}

function coverageV2(value: unknown, path: string): CodeGraphCoverage {
  const input = record(value, path);
  exactKeys(input, ["analyzedFiles", "totalFiles", "percentage", "truncated"], [], path);
  const result: CodeGraphCoverage = {
    analyzedFiles: nonNegativeInteger(input.analyzedFiles, `${path}.analyzedFiles`),
    totalFiles: nonNegativeInteger(input.totalFiles, `${path}.totalFiles`),
    percentage: finiteNumber(input.percentage, `${path}.percentage`),
    truncated: boolean(input.truncated, `${path}.truncated`),
  };
  if (result.analyzedFiles > result.totalFiles)
    throw new TypeError(`${path}.analyzedFiles must not exceed totalFiles`);
  if (result.percentage < 0 || result.percentage > 1)
    throw new TypeError(`${path}.percentage must be between 0 and 1`);
  const expected = result.totalFiles === 0 ? 1 : result.analyzedFiles / result.totalFiles;
  if (result.percentage !== expected)
    throw new TypeError(`${path}.percentage is inconsistent with file counts`);
  return result;
}

function metricsV2(value: unknown, path: string): CodeGraphMetrics {
  const input = record(value, path);
  exactKeys(input, ["nodeCount", "edgeCount", "diagnosticCount"], [], path);
  return {
    nodeCount: nonNegativeInteger(input.nodeCount, `${path}.nodeCount`),
    edgeCount: nonNegativeInteger(input.edgeCount, `${path}.edgeCount`),
    diagnosticCount: nonNegativeInteger(input.diagnosticCount, `${path}.diagnosticCount`),
  };
}

function diagnosticV2(value: unknown, path: string, manifestPaths: Set<string>): GraphDiagnostic {
  const input = record(value, path);
  exactKeys(input, ["code", "severity", "message"], ["location", "nodeId", "edgeId"], path);
  const severity = strictString(input.severity, `${path}.severity`);
  if (!graphDiagnosticSeverities.includes(severity as GraphDiagnostic["severity"]))
    throw new TypeError(`${path}.severity is not supported`);
  const result: GraphDiagnostic = {
    code: strictString(input.code, `${path}.code`),
    severity: severity as GraphDiagnostic["severity"],
    message: strictString(input.message, `${path}.message`),
  };
  if (input.location !== undefined)
    result.location = locationV2(input.location, `${path}.location`, manifestPaths);
  const nodeId = optionalStrictString(input, "nodeId", path);
  const edgeId = optionalStrictString(input, "edgeId", path);
  if (nodeId !== undefined) result.nodeId = nodeId;
  if (edgeId !== undefined) result.edgeId = edgeId;
  return result;
}

function validateEndpoints(
  nodes: readonly { id: string }[],
  edges: readonly { from: string; to: string }[],
): void {
  const nodeIds = new Set(nodes.map((item) => item.id));
  if (nodeIds.size !== nodes.length) throw new TypeError("graph.nodes contains duplicate ids");
  for (const [index, item] of edges.entries()) {
    if (!nodeIds.has(item.from))
      throw new TypeError(`edges[${index}].from references an unknown node`);
    if (!nodeIds.has(item.to)) throw new TypeError(`edges[${index}].to references an unknown node`);
  }
}

function parseV2(input: Record<string, unknown>): CodeGraphV2 {
  exactKeys(
    input,
    ["schemaVersion", "snapshot", "limits", "coverage", "metrics", "diagnostics", "nodes", "edges"],
    [],
    "graph",
  );
  const snapshot = parseRepositorySnapshot(input.snapshot);
  const manifestPaths = new Set(snapshot.manifest.map((item) => item.path));
  const limits = limitsV2(input.limits, "graph.limits");
  if (!Array.isArray(input.nodes)) throw new TypeError("graph.nodes must be an array");
  if (!Array.isArray(input.edges)) throw new TypeError("graph.edges must be an array");
  if (!Array.isArray(input.diagnostics)) throw new TypeError("graph.diagnostics must be an array");
  if (input.nodes.length > limits.maxNodes)
    throw new TypeError("graph.nodes exceeds limits.maxNodes");
  if (input.edges.length > limits.maxEdges)
    throw new TypeError("graph.edges exceeds limits.maxEdges");
  if (input.diagnostics.length > limits.maxDiagnostics)
    throw new TypeError("graph.diagnostics exceeds limits.maxDiagnostics");
  const nodes = input.nodes.map((item, index) => nodeV2(item, `nodes[${index}]`, manifestPaths));
  const edges = input.edges.map((item, index) => edgeV2(item, `edges[${index}]`, manifestPaths));
  const diagnostics = input.diagnostics.map((item, index) =>
    diagnosticV2(item, `diagnostics[${index}]`, manifestPaths),
  );
  validateEndpoints(nodes, edges);
  const nodeKinds = new Map(nodes.map((item) => [item.id, item.kind]));
  for (const [index, item] of edges.entries()) {
    if (
      (item.kind === "imports" || item.kind === "requires") &&
      nodeKinds.get(item.from) !== "file"
    ) {
      throw new TypeError(`edges[${index}].from must reference a file node for ${item.kind} edges`);
    }
  }
  const edgeIds = new Set(edges.map((item) => item.id));
  if (edgeIds.size !== edges.length) throw new TypeError("graph.edges contains duplicate ids");
  const nodeIds = new Set(nodes.map((item) => item.id));
  for (const [index, item] of diagnostics.entries()) {
    if (item.nodeId !== undefined && !nodeIds.has(item.nodeId))
      throw new TypeError(`diagnostics[${index}].nodeId references an unknown node`);
    if (item.edgeId !== undefined && !edgeIds.has(item.edgeId))
      throw new TypeError(`diagnostics[${index}].edgeId references an unknown edge`);
  }
  const metrics = metricsV2(input.metrics, "graph.metrics");
  if (
    metrics.nodeCount !== nodes.length ||
    metrics.edgeCount !== edges.length ||
    metrics.diagnosticCount !== diagnostics.length
  ) {
    throw new TypeError("graph.metrics counts are inconsistent");
  }
  const coverage = coverageV2(input.coverage, "graph.coverage");
  if (
    coverage.totalFiles !== snapshot.coverage.discoveredFiles ||
    coverage.analyzedFiles !== snapshot.coverage.analyzedFiles
  ) {
    throw new TypeError("graph.coverage is inconsistent with snapshot.coverage");
  }
  return {
    schemaVersion: graphSchemaVersionV2,
    snapshot,
    limits,
    coverage,
    metrics,
    diagnostics,
    nodes,
    edges,
  };
}

export function parseCodeGraph(value: unknown): CodeGraph {
  const input = record(value, "graph");
  if (input.schemaVersion === graphSchemaVersion) return parseV1(input);
  if (input.schemaVersion === graphSchemaVersionV2) return parseV2(input);
  throw new TypeError(
    `graph.schemaVersion must be "${graphSchemaVersion}" or "${graphSchemaVersionV2}"`,
  );
}
