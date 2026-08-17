export const graphSchemaVersion = "1.0" as const;

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

export type GraphSnapshot = {
  repositoryId: string;
  commitSha: string;
  ref: string;
};

export type CodeGraph = {
  schemaVersion: typeof graphSchemaVersion;
  snapshot: GraphSnapshot;
  nodes: GraphNode[];
  edges: GraphEdge[];
};
