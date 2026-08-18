import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleMcpRequest, mcpToolsDefinition } from "../lib/mcp/mcp-server.ts";
import { codeGraphLimits, type CodeGraphV2 } from "../lib/domain/code-graph.ts";
import { repositorySnapshotLimits } from "../lib/domain/repository-snapshot.ts";

const sampleGraph: CodeGraphV2 = {
  schemaVersion: "2.0",
  snapshot: {
    snapshotId: "snap-123",
    repositoryId: "github:owner/repo",
    provider: "github",
    requestedRef: "main",
    commitSha: "a".repeat(40),
    treeSha: "b".repeat(40),
    manifest: [
      {
        path: "src/auth.ts",
        mode: "100644",
        kind: "blob",
        size: 100,
        gitObjectSha: "c".repeat(40),
        eligibleForAnalysis: true,
      },
    ],
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
  coverage: { analyzedFiles: 1, totalFiles: 1, percentage: 1, truncated: false },
  metrics: { nodeCount: 2, edgeCount: 1, diagnosticCount: 0 },
  diagnostics: [],
  nodes: [
    {
      id: "file:src/auth.ts",
      kind: "file",
      name: "auth.ts",
      location: { path: "src/auth.ts" },
      metadata: { path: "src/auth.ts" },
    },
    {
      id: "symbol:src/auth.ts:login",
      kind: "symbol",
      name: "login",
      location: { path: "src/auth.ts" },
      metadata: { symbolKind: "function", exported: true },
    },
  ],
  edges: [
    {
      id: "e1",
      from: "file:src/auth.ts",
      to: "symbol:src/auth.ts:login",
      kind: "contains",
      provenance: "EXTRACTED",
      confidence: 1,
      evidence: [{ path: "src/auth.ts", startLine: 1 }],
    },
  ],
};

describe("MCP Server Protocol (Phase 9)", () => {
  it("handles initialize method", () => {
    const res = handleMcpRequest(sampleGraph, { jsonrpc: "2.0", id: 1, method: "initialize" });
    assert.equal(res.jsonrpc, "2.0");
    assert.equal(res.id, 1);
    const result = res.result as { serverInfo: { name: string } };
    assert.equal(result.serverInfo.name, "repocompass-mcp");
  });

  it("handles tools/list method", () => {
    const res = handleMcpRequest(sampleGraph, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    assert.equal(res.jsonrpc, "2.0");
    const result = res.result as { tools: unknown[] };
    assert.equal(result.tools.length, mcpToolsDefinition.length);
  });

  it("handles tools/call repocompass_query", () => {
    const res = handleMcpRequest(sampleGraph, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "repocompass_query",
        arguments: { type: "search", text: "auth", cursor: 0 },
      },
    });
    assert.equal(res.jsonrpc, "2.0");
    const result = res.result as { content: { text: string }[] };
    assert.ok(result.content[0].text.includes("auth.ts"));
  });

  it("handles tools/call repocompass_answer", () => {
    const res = handleMcpRequest(sampleGraph, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "repocompass_answer",
        arguments: { question: "Where is login handled?" },
      },
    });
    assert.equal(res.jsonrpc, "2.0");
    const result = res.result as { content: { text: string }[] };
    assert.ok(result.content[0].text.includes("login"));
  });

  it("returns error for unknown method", () => {
    const res = handleMcpRequest(sampleGraph, { jsonrpc: "2.0", id: 5, method: "unknown/method" });
    assert.equal(res.error?.code, -32601);
  });
});
