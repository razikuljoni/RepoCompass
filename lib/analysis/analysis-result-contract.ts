import type { CodeGraph } from "../domain/code-graph.ts";
import type { Model } from "../domain/repository-model.ts";
import {
  parseRepositorySnapshot,
  parseRepositorySnapshotCoverage,
  repositorySnapshotsEqual,
  type RepositorySnapshot,
  type RepositorySnapshotCoverage,
} from "../domain/repository-snapshot.ts";
import { parseCodeGraph } from "./code-graph-contract.ts";

export const analysisResultSchemaVersion = "1.0" as const;

export type AnalysisResultRepository = {
  repositoryId: string;
  provider: "github";
  owner: string;
  name: string;
};

export type AnalysisResult = {
  schemaVersion: typeof analysisResultSchemaVersion;
  analyzerVersion: string;
  jobId: string;
  snapshot: RepositorySnapshot;
  repository: AnalysisResultRepository;
  model: Model;
  coverage: RepositorySnapshotCoverage;
  graph?: CodeGraph;
};

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number`);
  }
  return value;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  return array(value, path).map((item, index) => requiredString(item, `${path}[${index}]`));
}

function parseModel(value: unknown): Model {
  const input = record(value, "result.model");
  const countedNames = (value: unknown, path: string) =>
    array(value, path).map((item, index) => {
      const entry = record(item, `${path}[${index}]`);
      return {
        name: requiredString(entry.name, `${path}[${index}].name`),
        count: finiteNumber(entry.count, `${path}[${index}].count`),
      };
    });
  const findings = (value: unknown, path: string) =>
    array(value, path).map((item, index) => record(item, `${path}[${index}]`));
  const model: Model = {
    topDirs: countedNames(input.topDirs, "result.model.topDirs"),
    extensions: countedNames(input.extensions, "result.model.extensions"),
    sourceFiles: stringArray(input.sourceFiles, "result.model.sourceFiles"),
    testFiles: stringArray(input.testFiles, "result.model.testFiles"),
    configFiles: stringArray(input.configFiles, "result.model.configFiles"),
    docs: stringArray(input.docs, "result.model.docs"),
    workflows: stringArray(input.workflows, "result.model.workflows"),
    security: findings(input.security, "result.model.security").map((entry, index) => ({
      level: requiredString(entry.level, `result.model.security[${index}].level`),
      title: requiredString(entry.title, `result.model.security[${index}].title`),
      detail: requiredString(entry.detail, `result.model.security[${index}].detail`),
      ...(entry.file === undefined
        ? {}
        : { file: requiredString(entry.file, `result.model.security[${index}].file`) }),
      ...(entry.line === undefined
        ? {}
        : { line: finiteNumber(entry.line, `result.model.security[${index}].line`) }),
    })),
    risks: findings(input.risks, "result.model.risks").map((entry, index) => ({
      title: requiredString(entry.title, `result.model.risks[${index}].title`),
      detail: requiredString(entry.detail, `result.model.risks[${index}].detail`),
      score: finiteNumber(entry.score, `result.model.risks[${index}].score`),
      ...(entry.file === undefined
        ? {}
        : { file: requiredString(entry.file, `result.model.risks[${index}].file`) }),
    })),
    recommendations: findings(input.recommendations, "result.model.recommendations").map(
      (entry, index) => ({
        priority: requiredString(entry.priority, `result.model.recommendations[${index}].priority`),
        title: requiredString(entry.title, `result.model.recommendations[${index}].title`),
        reason: requiredString(entry.reason, `result.model.recommendations[${index}].reason`),
      }),
    ),
  };
  if (input.edges !== undefined) {
    model.edges = array(input.edges, "result.model.edges").map((item, index) => {
      const entry = record(item, `result.model.edges[${index}]`);
      const kind = requiredString(entry.kind, `result.model.edges[${index}].kind`);
      if (kind !== "import" && kind !== "require") {
        throw new TypeError(`result.model.edges[${index}].kind is not supported`);
      }
      return {
        from: requiredString(entry.from, `result.model.edges[${index}].from`),
        to: requiredString(entry.to, `result.model.edges[${index}].to`),
        kind,
      };
    });
  }
  if (input.symbols !== undefined) {
    model.symbols = array(input.symbols, "result.model.symbols").map((item, index) => {
      const entry = record(item, `result.model.symbols[${index}]`);
      return {
        name: requiredString(entry.name, `result.model.symbols[${index}].name`),
        kind: requiredString(entry.kind, `result.model.symbols[${index}].kind`),
        file: requiredString(entry.file, `result.model.symbols[${index}].file`),
        line: finiteNumber(entry.line, `result.model.symbols[${index}].line`),
      };
    });
  }
  if (input.routes !== undefined) {
    model.routes = array(input.routes, "result.model.routes").map((item, index) => {
      const entry = record(item, `result.model.routes[${index}]`);
      return {
        method: requiredString(entry.method, `result.model.routes[${index}].method`),
        path: requiredString(entry.path, `result.model.routes[${index}].path`),
        file: requiredString(entry.file, `result.model.routes[${index}].file`),
      };
    });
  }
  if (input.dependencies !== undefined) {
    model.dependencies = stringArray(input.dependencies, "result.model.dependencies");
  }
  if (input.terms !== undefined) {
    model.terms = array(input.terms, "result.model.terms").map((item, index) => {
      const entry = record(item, `result.model.terms[${index}]`);
      return {
        term: requiredString(entry.term, `result.model.terms[${index}].term`),
        detail: requiredString(entry.detail, `result.model.terms[${index}].detail`),
        evidence: requiredString(entry.evidence, `result.model.terms[${index}].evidence`),
      };
    });
  }
  return model;
}

function parseRepository(value: unknown, snapshot: RepositorySnapshot): AnalysisResultRepository {
  const input = record(value, "result.repository");
  if (input.provider !== "github") {
    throw new TypeError('result.repository.provider must be "github"');
  }
  const repositoryId = requiredString(input.repositoryId, "result.repository.repositoryId");
  if (repositoryId !== snapshot.repositoryId) {
    throw new TypeError("result.repository.repositoryId must match result.snapshot.repositoryId");
  }
  return {
    repositoryId,
    provider: "github",
    owner: requiredString(input.owner, "result.repository.owner"),
    name: requiredString(input.name, "result.repository.name"),
  };
}

export function parseAnalysisResult(value: unknown): AnalysisResult {
  const input = record(value, "result");
  if (input.schemaVersion !== analysisResultSchemaVersion) {
    throw new TypeError(`result.schemaVersion must be "${analysisResultSchemaVersion}"`);
  }
  const snapshot = parseRepositorySnapshot(input.snapshot, "result.snapshot");
  const coverage = parseRepositorySnapshotCoverage(input.coverage, "result.coverage");
  if (JSON.stringify(coverage) !== JSON.stringify(snapshot.coverage)) {
    throw new TypeError("result.coverage must match result.snapshot.coverage");
  }
  const result: AnalysisResult = {
    schemaVersion: analysisResultSchemaVersion,
    analyzerVersion: requiredString(input.analyzerVersion, "result.analyzerVersion"),
    jobId: requiredString(input.jobId, "result.jobId"),
    snapshot,
    repository: parseRepository(input.repository, snapshot),
    model: parseModel(input.model),
    coverage,
  };
  if (input.graph !== undefined) {
    const graph = parseCodeGraph(input.graph);
    if (!repositorySnapshotsEqual(snapshot, graph.snapshot)) {
      throw new TypeError("result.graph.snapshot must match result.snapshot");
    }
    result.graph = graph;
  }
  return result;
}
