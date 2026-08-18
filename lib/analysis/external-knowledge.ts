import type {
  CodeGraphV2,
  GraphEdgeV2,
  GraphNodeV2,
  SchemaNodeMetadata,
} from "../domain/code-graph";

export type RationaleComment = {
  kind: "NOTE" | "WHY" | "HACK" | "ADR" | "TODO";
  text: string;
  line: number;
  symbolId?: string;
};

export type KnowledgeExtractorInput = {
  path: string;
  content: string;
};

export type ExtractedKnowledge = {
  nodes: GraphNodeV2[];
  edges: GraphEdgeV2[];
  rationales: RationaleComment[];
};

export function extractMarkdownKnowledge(path: string, content: string): ExtractedKnowledge {
  const nodes: GraphNodeV2[] = [];
  const edges: GraphEdgeV2[] = [];
  const rationales: RationaleComment[] = [];

  const docNodeId = `document:${path}`;
  nodes.push({
    id: docNodeId,
    kind: "file",
    name: path.split("/").pop() || path,
    location: { path },
    metadata: {
      path,
      language: "markdown",
      sizeBytes: content.length,
      module: "doc",
    },
  });

  // Extract headings as document sections / concept nodes
  const lines = content.split("\n");
  lines.forEach((line, index) => {
    const match = line.match(/^(#{1,3})\s+(.+)$/);
    if (match) {
      const heading = match[2].trim();
      const sectionNodeId = `document:${path}#line-${index + 1}`;
      nodes.push({
        id: sectionNodeId,
        kind: "symbol",
        name: heading,
        location: { path, startLine: index + 1 },
        metadata: {
          symbolKind: "document-heading",
          exported: true,
        },
      });

      edges.push({
        id: `edge:${docNodeId}->${sectionNodeId}:contains`,
        from: docNodeId,
        to: sectionNodeId,
        kind: "contains",
        provenance: { method: "doc-extractor", rule: "markdown-heading" },
        evidence: [{ path, startLine: index + 1 }],
      });
    }
  });

  return { nodes, edges, rationales };
}

export function extractSqlSchemaKnowledge(path: string, content: string): ExtractedKnowledge {
  const nodes: GraphNodeV2[] = [];
  const edges: GraphEdgeV2[] = [];

  const fileNodeId = `file:${path}`;
  nodes.push({
    id: fileNodeId,
    kind: "file",
    name: path.split("/").pop() || path,
    location: { path },
    metadata: { path, language: "sql", sizeBytes: content.length },
  });

  // Match CREATE TABLE statements
  const createTableRegex =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`|"|')?([a-zA-Z0-9_]+)(?:`|"|')?\s*\(([^;]+)\)/gi;
  let match: RegExpExecArray | null;

  while ((match = createTableRegex.exec(content)) !== null) {
    const tableName = match[1];
    const body = match[2];
    const line = content.substring(0, match.index).split("\n").length;

    // Extract column names
    const fields = body
      .split(",")
      .map((col) => col.trim().split(/\s+/)[0].replace(/[`"']/g, ""))
      .filter((col) => col && !/^(PRIMARY|FOREIGN|KEY|CONSTRAINT|INDEX|UNIQUE)/i.test(col));

    const schemaMetadata: SchemaNodeMetadata = {
      schemaKind: "sql-table",
      qualifiedName: tableName,
      fields,
    };

    const schemaNodeId = `schema:${path}:${tableName}`;
    nodes.push({
      id: schemaNodeId,
      kind: "schema",
      name: tableName,
      location: { path, startLine: line },
      metadata: schemaMetadata,
    });

    edges.push({
      id: `edge:${fileNodeId}->${schemaNodeId}:declares`,
      from: fileNodeId,
      to: schemaNodeId,
      kind: "declares",
      provenance: { method: "schema-extractor", rule: "sql-create-table" },
      evidence: [{ path, startLine: line }],
    });
  }

  return { nodes, edges, rationales: [] };
}

export function extractRationaleComments(path: string, content: string): RationaleComment[] {
  const rationales: RationaleComment[] = [];
  const lines = content.split("\n");
  const regex = /\/\/\s*(NOTE|WHY|HACK|ADR|TODO):\s*(.+)$/i;

  lines.forEach((line, idx) => {
    const match = line.match(regex);
    if (match) {
      rationales.push({
        kind: match[1].toUpperCase() as RationaleComment["kind"],
        text: match[2].trim(),
        line: idx + 1,
      });
    }
  });

  return rationales;
}

export function enrichCodeGraphWithExternalKnowledge(
  graph: CodeGraphV2,
  inputs: KnowledgeExtractorInput[],
): CodeGraphV2 {
  const newNodes = [...graph.nodes];
  const newEdges = [...graph.edges];
  const nodeIds = new Set(newNodes.map((n) => n.id));
  const edgeIds = new Set(newEdges.map((e) => e.id));

  for (const input of inputs) {
    let result: ExtractedKnowledge | null = null;
    if (input.path.endsWith(".md")) {
      result = extractMarkdownKnowledge(input.path, input.content);
    } else if (input.path.endsWith(".sql")) {
      result = extractSqlSchemaKnowledge(input.path, input.content);
    }

    if (result) {
      for (const node of result.nodes) {
        if (!nodeIds.has(node.id)) {
          nodeIds.add(node.id);
          newNodes.push(node);
        }
      }
      for (const edge of result.edges) {
        if (!edgeIds.has(edge.id)) {
          edgeIds.add(edge.id);
          newEdges.push(edge);
        }
      }
    }

    // Extract rationale comments from any source file
    const rationales = extractRationaleComments(input.path, input.content);
    for (const r of rationales) {
      const rationaleNodeId = `symbol:${input.path}:rationale-${r.line}`;
      if (!nodeIds.has(rationaleNodeId)) {
        nodeIds.add(rationaleNodeId);
        newNodes.push({
          id: rationaleNodeId,
          kind: "symbol",
          name: `${r.kind}: ${r.text.slice(0, 30)}`,
          location: { path: input.path, startLine: r.line },
          metadata: {
            symbolKind: "rationale-comment",
            exported: false,
          },
        });
      }

      const fileNodeId = `file:${input.path}`;
      const edgeId = `edge:${fileNodeId}->${rationaleNodeId}:contains`;
      if (!edgeIds.has(edgeId)) {
        edgeIds.add(edgeId);
        newEdges.push({
          id: edgeId,
          from: fileNodeId,
          to: rationaleNodeId,
          kind: "contains",
          provenance: { method: "comment-extractor", rule: r.kind.toLowerCase() },
          evidence: [{ path: input.path, startLine: r.line }],
        });
      }
    }
  }

  return {
    ...graph,
    nodes: newNodes,
    edges: newEdges,
    metrics: {
      ...graph.metrics,
      nodeCount: newNodes.length,
      edgeCount: newEdges.length,
    },
  };
}
