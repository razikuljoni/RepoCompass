import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzePRImpact, type PRFileChange } from "../lib/analysis/pr-intelligence.ts";
import type { CodeGraphV2 } from "../lib/domain/code-graph.ts";

const sampleGraph: CodeGraphV2 = {
  schemaVersion: "2.0",
  snapshot: {
    repository: "owner/repo",
    requestedRef: "main",
    commitSha: "a".repeat(40),
    treeSha: "b".repeat(40),
    createdAt: new Date().toISOString(),
    inventory: [],
    limits: { maxFiles: 1000, maxFileSizeBytes: 1000000, maxTotalBytes: 50000000 },
    coverage: {
      discoveredFiles: 3,
      analyzedFiles: 3,
      skippedFiles: 0,
      discoveredBytes: 1000,
      analyzedBytes: 1000,
      skippedBytes: 0,
      truncated: false,
    },
  },
  limits: {
    maxNodes: 100,
    maxEdges: 500,
    maxEvidencePerEdge: 5,
    maxDiagnostics: 10,
    maxCandidatesPerAmbiguity: 5,
  },
  coverage: {
    discoveredFiles: 3,
    analyzedFiles: 3,
    skippedFiles: 0,
    discoveredBytes: 1000,
    analyzedBytes: 1000,
    skippedBytes: 0,
    truncated: false,
  },
  metrics: {
    fileNodeCount: 3,
    symbolNodeCount: 2,
    packageNodeCount: 0,
    routeNodeCount: 1,
    schemaNodeCount: 0,
    totalNodeCount: 6,
    totalEdgeCount: 4,
    maxDepth: 2,
  },
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
    {
      id: "file:src/server.ts",
      kind: "file",
      name: "server.ts",
      location: { path: "src/server.ts" },
      metadata: { path: "src/server.ts" },
    },
    {
      id: "route:src/server.ts:POST:/api/login",
      kind: "route",
      name: "POST /api/login",
      location: { path: "src/server.ts" },
      metadata: { path: "/api/login", methods: ["POST"] },
    },
    {
      id: "file:tests/auth.test.ts",
      kind: "file",
      name: "auth.test.ts",
      location: { path: "tests/auth.test.ts" },
      metadata: { path: "tests/auth.test.ts" },
    },
    {
      id: "symbol:tests/auth.test.ts:testLogin",
      kind: "symbol",
      name: "testLogin",
      location: { path: "tests/auth.test.ts" },
      metadata: { symbolKind: "function", exported: false },
    },
  ],
  edges: [
    {
      id: "e1",
      from: "file:src/server.ts",
      to: "file:src/auth.ts",
      kind: "imports",
      provenance: { method: "ast", rule: "ts" },
      evidence: [],
    },
    {
      id: "e2",
      from: "route:src/server.ts:POST:/api/login",
      to: "symbol:src/auth.ts:login",
      kind: "calls",
      provenance: { method: "ast", rule: "ts" },
      evidence: [],
    },
    {
      id: "e3",
      from: "file:tests/auth.test.ts",
      to: "file:src/auth.ts",
      kind: "tests",
      provenance: { method: "ast", rule: "ts" },
      evidence: [],
    },
  ],
};

describe("analyzePRImpact", () => {
  it("calculates impact, affected routes, public exports, and risk score for PR changes", () => {
    const changes: PRFileChange[] = [
      { path: "src/auth.ts", status: "modified", additions: 25, deletions: 10 },
    ];

    const report = analyzePRImpact(sampleGraph, changes);

    assert.equal(report.changedFiles, 1);
    assert.equal(report.directlyAffectedNodeCount, 2); // auth.ts file + login symbol
    assert.ok(report.transitiveImpactCount > 0);
    assert.equal(report.affectedPublicExports.length, 1);
    assert.equal(report.affectedPublicExports[0].name, "login");
    assert.equal(report.affectedRoutes.length, 1);
    assert.equal(report.affectedRoutes[0].name, "POST /api/login");
    assert.ok(report.riskScore > 0);
    assert.ok(["low", "medium", "high", "critical"].includes(report.riskLevel));
  });

  it("handles empty changes gracefully", () => {
    const report = analyzePRImpact(sampleGraph, []);
    assert.equal(report.changedFiles, 0);
    assert.equal(report.directlyAffectedNodeCount, 0);
    assert.equal(report.transitiveImpactCount, 0);
    assert.equal(report.riskScore, 0);
    assert.equal(report.riskLevel, "low");
  });

  it("evaluates deletion of files as high risk factor", () => {
    const changes: PRFileChange[] = [{ path: "src/auth.ts", status: "deleted" }];
    const report = analyzePRImpact(sampleGraph, changes);
    assert.ok(report.riskFactors.some((f) => f.title.includes("Deletions")));
  });
});
