import type { RepositorySnapshot } from "./repository-snapshot.ts";

export const graphSchemaVersion = "1.0" as const;
export const graphSchemaVersionV2 = "2.0" as const;

export const graphNodeKinds = ["file", "symbol", "package", "route", "document"] as const;
export type GraphNodeKind = (typeof graphNodeKinds)[number];

export const graphEdgeKinds = [
  "contains",
  "declares",
  "imports",
  "requires",
  "references",
  "calls",
  "extends",
  "implements",
  "handles-route",
  "depends-on",
] as const;
export type GraphEdgeKind = (typeof graphEdgeKinds)[number];

export const graphProvenanceKinds = ["EXTRACTED", "INFERRED", "AMBIGUOUS"] as const;
export type GraphProvenance = (typeof graphProvenanceKinds)[number];

export type GraphLocation = {
  path: string;
  startLine?: number;
  endLine?: number;
};

export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  name: string;
  location?: GraphLocation;
  language?: string;
};

export type GraphEvidence = GraphLocation & {
  excerptHash?: string;
};

export type GraphEdge = {
  from: string;
  to: string;
  kind: GraphEdgeKind;
  provenance: GraphProvenance;
  confidence?: number;
  evidence: GraphEvidence[];
};

export type GraphSnapshot = RepositorySnapshot;

export type CodeGraphV1 = {
  schemaVersion: typeof graphSchemaVersion;
  snapshot: GraphSnapshot;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export const graphNodeKindsV2 = ["file", "symbol", "package", "route", "schema"] as const;
export type GraphNodeKindV2 = (typeof graphNodeKindsV2)[number];

export const graphEdgeKindsV2 = [
  "contains",
  "declares",
  "imports",
  "requires",
  "references",
  "calls",
  "extends",
  "implements",
  "handles-route",
  "depends-on",
  "tests",
  "reads-schema",
  "writes-schema",
] as const;
export type GraphEdgeKindV2 = (typeof graphEdgeKindsV2)[number];

export type GraphLocationV2 = {
  path: string;
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
};

export type FileNodeMetadata = {
  path: string;
  language?: string;
  sizeBytes?: number;
  contentSha256?: string;
  module?: string;
};

export type SymbolNodeMetadata = {
  symbolKind: string;
  qualifiedName?: string;
  signature?: string;
  visibility?: "public" | "protected" | "private" | "internal";
  exported?: boolean;
  async?: boolean;
};

export type PackageNodeMetadata = {
  packageName: string;
  version?: string;
  manager?: string;
  workspacePath?: string;
};

export type RouteNodeMetadata = {
  path: string;
  methods: string[];
  framework?: string;
};

export type SchemaNodeMetadata = {
  schemaKind: string;
  qualifiedName?: string;
  fields?: string[];
};

export type GraphNodeV2 =
  | {
      id: string;
      kind: "file";
      name: string;
      location?: GraphLocationV2;
      metadata: FileNodeMetadata;
    }
  | {
      id: string;
      kind: "symbol";
      name: string;
      location?: GraphLocationV2;
      metadata: SymbolNodeMetadata;
    }
  | {
      id: string;
      kind: "package";
      name: string;
      location?: GraphLocationV2;
      metadata: PackageNodeMetadata;
    }
  | {
      id: string;
      kind: "route";
      name: string;
      location?: GraphLocationV2;
      metadata: RouteNodeMetadata;
    }
  | {
      id: string;
      kind: "schema";
      name: string;
      location?: GraphLocationV2;
      metadata: SchemaNodeMetadata;
    };

export type GraphEvidenceV2 = GraphLocationV2 & {
  excerptHash?: string;
  description?: string;
};

export const graphImportModes = ["static", "dynamic", "require", "type"] as const;
export type GraphImportMode = (typeof graphImportModes)[number];
export const graphResolutionKinds = ["resolved", "external", "unresolved", "ambiguous"] as const;
export type GraphResolution = (typeof graphResolutionKinds)[number];

export type GraphImportMetadata = {
  mode: GraphImportMode;
  specifier: string;
  typeOnly: boolean;
  resolution: GraphResolution;
  candidates: string[];
};

export type GraphEdgeV2 = {
  id: string;
  from: string;
  to: string;
  kind: GraphEdgeKindV2;
  provenance: GraphProvenance;
  confidence?: number;
  evidence: GraphEvidenceV2[];
  metadata?: GraphImportMetadata;
};

export const graphDiagnosticSeverities = ["info", "warning", "error"] as const;
export type GraphDiagnosticSeverity = (typeof graphDiagnosticSeverities)[number];

export type GraphDiagnostic = {
  code: string;
  severity: GraphDiagnosticSeverity;
  message: string;
  location?: GraphLocationV2;
  nodeId?: string;
  edgeId?: string;
};

export const codeGraphLimits = {
  maxNodes: 50_000,
  maxEdges: 200_000,
  maxEvidencePerEdge: 100,
  maxDiagnostics: 10_000,
  maxCandidatesPerEdge: 100,
} as const;

export type CodeGraphLimits = typeof codeGraphLimits;

export type CodeGraphMetrics = {
  nodeCount: number;
  edgeCount: number;
  diagnosticCount: number;
};

export type CodeGraphCoverage = {
  analyzedFiles: number;
  totalFiles: number;
  percentage: number;
  truncated: boolean;
};

export type CodeGraphV2 = {
  schemaVersion: typeof graphSchemaVersionV2;
  snapshot: GraphSnapshot;
  limits: CodeGraphLimits;
  coverage: CodeGraphCoverage;
  metrics: CodeGraphMetrics;
  diagnostics: GraphDiagnostic[];
  nodes: GraphNodeV2[];
  edges: GraphEdgeV2[];
};

export type CodeGraph = CodeGraphV1 | CodeGraphV2;
