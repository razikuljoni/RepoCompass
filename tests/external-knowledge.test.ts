import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractMarkdownKnowledge,
  extractSqlSchemaKnowledge,
  extractRationaleComments,
  enrichCodeGraphWithExternalKnowledge,
} from "../lib/analysis/external-knowledge.ts";
import { codeGraphLimits, type CodeGraphV2, type SchemaNodeMetadata } from "../lib/domain/code-graph.ts";
import { repositorySnapshotLimits } from "../lib/domain/repository-snapshot.ts";

const sampleBaseGraph: CodeGraphV2 = {
  schemaVersion: "2.0",
  snapshot: {
    snapshotId: "snapshot-1",
    provider: "github",
    repositoryId: "github:owner/repo",
    requestedRef: "main",
    commitSha: "a".repeat(40),
    treeSha: "b".repeat(40),
    manifest: [],
    limits: repositorySnapshotLimits,
    coverage: {
      discoveredFiles: 1,
      analyzedFiles: 1,
      skippedFiles: 0,
      discoveredBytes: 100,
      analyzedBytes: 100,
      truncated: false,
    },
  },
  limits: codeGraphLimits,
  coverage: {
    analyzedFiles: 1,
    totalFiles: 1,
    percentage: 100,
    truncated: false,
  },
  metrics: {
    nodeCount: 1,
    edgeCount: 0,
    diagnosticCount: 0,
  },
  diagnostics: [],
  nodes: [
    {
      id: "file:src/index.ts",
      kind: "file",
      name: "index.ts",
      location: { path: "src/index.ts" },
      metadata: { path: "src/index.ts" },
    },
  ],
  edges: [],
};

describe("External Knowledge Extractor (Phase 8)", () => {
  it("extracts markdown headings as document section nodes", () => {
    const md = `# Overview\nThis is a doc.\n## Architecture\nDetails here.`;
    const result = extractMarkdownKnowledge("docs/ARCHITECTURE.md", md);

    assert.equal(result.nodes.length, 3); // 1 file + 2 headings
    assert.equal(result.edges.length, 2);
    assert.equal(result.nodes[1].name, "Overview");
    assert.equal(result.nodes[2].name, "Architecture");
  });

  it("extracts SQL CREATE TABLE as schema nodes with columns", () => {
    const sql = `CREATE TABLE users (\n id INT PRIMARY KEY,\n email VARCHAR(255)\n);`;
    const result = extractSqlSchemaKnowledge("db/schema.sql", sql);

    assert.equal(result.nodes.length, 2); // 1 file + 1 table schema
    assert.equal(result.nodes[1].kind, "schema");
    assert.equal(result.nodes[1].name, "users");
    assert.deepEqual((result.nodes[1].metadata as SchemaNodeMetadata).fields, ["id", "email"]);
  });

  it("extracts NOTE, WHY, HACK, ADR comments from source code", () => {
    const code = `// NOTE: cached to improve performance\nfunction get() {}\n// WHY: bypass lock due to reentrancy`;
    const rationales = extractRationaleComments("src/index.ts", code);

    assert.equal(rationales.length, 2);
    assert.equal(rationales[0].kind, "NOTE");
    assert.equal(rationales[1].kind, "WHY");
  });

  it("enriches CodeGraph with external knowledge inputs", () => {
    const enriched = enrichCodeGraphWithExternalKnowledge(sampleBaseGraph, [
      { path: "README.md", content: "# Main Title" },
      { path: "schema.sql", content: "CREATE TABLE items (id INT);" },
      { path: "src/index.ts", content: "// HACK: work around node bug" },
    ]);

    assert.ok(enriched.nodes.length > sampleBaseGraph.nodes.length);
    assert.ok(enriched.edges.length > sampleBaseGraph.edges.length);
    assert.ok(enriched.nodes.some((n) => n.kind === "schema"));
  });
});
