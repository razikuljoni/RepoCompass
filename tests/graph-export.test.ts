import assert from "node:assert";
import { test } from "node:test";
import {
  codeGraphToMermaid,
  codeGraphToReport,
  codeGraphToHtml,
} from "../lib/analysis/graph-export.ts";
import type { CodeGraphV2 } from "../lib/domain/code-graph.ts";

function sampleGraph(): CodeGraphV2 {
  return {
    schemaVersion: "2.0",
    snapshot: {
      provider: "github",
      repository: { owner: "owner", name: "repo" },
      requestedRef: "main",
      commitSha: "1111111111111111111111111111111111111111",
      treeSha: "2222222222222222222222222222222222222222",
      manifest: [],
    },
    limits: { maxFiles: 100, maxSizeBytes: 100000, maxTotalBytes: 5000000 },
    coverage: { discoveredFiles: 2, analyzedFiles: 2, skippedFiles: 0, truncation: false },
    metrics: { files: 2, symbols: 1, routes: 1, packages: 0 },
    diagnostics: [],
    nodes: [
      {
        id: "node-file-1",
        kind: "file",
        name: "src/app.ts",
        location: { path: "src/app.ts" },
        metadata: { path: "src/app.ts" },
      },
      {
        id: "node-file-2",
        kind: "file",
        name: "src/util.ts",
        location: { path: "src/util.ts" },
        metadata: { path: "src/util.ts" },
      },
      {
        id: "node-sym-1",
        kind: "symbol",
        name: "appHandler",
        location: { path: "src/app.ts" },
        metadata: { symbolKind: "function" },
      },
    ],
    edges: [
      {
        id: "edge-1",
        from: "node-file-1",
        to: "node-file-2",
        kind: "imports",
        provenance: { extractor: "ts", extractorVersion: "1.0", ruleId: "import" },
        evidence: [{ path: "src/app.ts", startLine: 1 }],
      },
      {
        id: "edge-2",
        from: "node-sym-1",
        to: "node-file-2",
        kind: "calls",
        provenance: { extractor: "ts", extractorVersion: "1.0", ruleId: "call" },
        evidence: [{ path: "src/app.ts", startLine: 5 }],
      },
    ],
  };
}

test("codeGraphToMermaid generates deterministic diagram syntax", () => {
  const g = sampleGraph();
  const m = codeGraphToMermaid(g);
  assert.ok(m.startsWith("graph TD"));
  assert.ok(m.includes("src/app.ts"));
  assert.ok(m.includes("imports"));
  assert.ok(m.includes("calls"));
});

test("codeGraphToReport generates Markdown report", () => {
  const g = sampleGraph();
  const r = codeGraphToReport(g);
  assert.ok(r.includes("# CodeGraph Analysis Report"));
  assert.ok(r.includes("owner/repo"));
  assert.ok(r.includes("```mermaid"));
  assert.ok(r.includes("1111111111111111111111111111111111111111"));
});

test("codeGraphToHtml generates self-contained static HTML page", () => {
  const g = sampleGraph();
  const html = codeGraphToHtml(g);
  assert.ok(html.includes("<!DOCTYPE html>"));
  assert.ok(html.includes("owner/repo"));
  assert.ok(html.includes('id="graph-data"'));
});
