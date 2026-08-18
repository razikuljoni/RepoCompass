import { parseAnalysisResult, type AnalysisResult } from "../analysis/analysis-result-contract.ts";
import { compareCodeGraphs } from "../analysis/graph-diff.ts";
import { analyzePRImpact, type PRFileChange } from "../analysis/pr-intelligence.ts";
import {
  codeGraphToHtml,
  codeGraphToMermaid,
  codeGraphToReport,
} from "../analysis/graph-export.ts";
import { canonicalGraphJson, executeGraphQuery } from "../analysis/graph-query-engine.ts";
import type { GraphQuery } from "../analysis/graph-query-contract.ts";
import { answerRepositoryQuestion } from "../analysis/repository-question-engine.ts";
import type { AnalysisJobStage, AnalysisJobStatus } from "../domain/analysis-job.ts";
import { createAnalysis, type JobPipelineDependencies } from "../jobs/pipeline.ts";
import { decodeJson, sha256 } from "../persistence/artifact-store.ts";
import type {
  AnalysisJobRecord,
  AnalysisStore,
  RepositorySnapshotRecord,
} from "../persistence/analysis-store.ts";
import { GitHubClientError } from "../providers/github-client.ts";
import { createCapabilityToken } from "./capability.ts";

export type AnalysisSnapshotIdentity = {
  snapshotId: string;
  repositoryId: string;
  requestedRef: string;
  commitSha: string;
  treeSha: string;
};

export type AnalysisProgressResponse = {
  completedUnits: number;
  totalUnits: number;
};

export type SafeAnalysisError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type AnalysisStatusResponse = {
  analysisId: string;
  status: AnalysisJobStatus;
  stage: AnalysisJobStage;
  progress: AnalysisProgressResponse;
  snapshot: AnalysisSnapshotIdentity;
  error: SafeAnalysisError | null;
};

export type CreateAnalysisResponse = AnalysisStatusResponse & {
  capabilityToken: string;
};

export type AnalysisResultResponse = {
  analysisId: string;
  status: "succeeded";
  result: AnalysisResult;
};

export class AnalysisServiceError extends Error {
  readonly code: "not_found" | "not_ready" | "result_unavailable" | "result_invalid";

  constructor(
    code: "not_found" | "not_ready" | "result_unavailable" | "result_invalid",
    message: string,
  ) {
    super(message);
    this.name = "AnalysisServiceError";
    this.code = code;
  }
}

export class CreateAnalysisError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;

  constructor(status: number, code: string, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "CreateAnalysisError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type AnalysisServiceDependencies = Pick<
  JobPipelineDependencies,
  "analysisStore" | "artifactStore"
> & {
  pipeline: JobPipelineDependencies;
  capabilitySecret: string;
};

function snapshotIdentity(snapshot: RepositorySnapshotRecord): AnalysisSnapshotIdentity {
  return {
    snapshotId: snapshot.id,
    repositoryId: snapshot.repositoryId,
    requestedRef: snapshot.requestedRef,
    commitSha: snapshot.commitSha,
    treeSha: snapshot.treeSha,
  };
}

export function toAnalysisStatusResponse(
  job: AnalysisJobRecord,
  snapshot: RepositorySnapshotRecord,
): AnalysisStatusResponse {
  return {
    analysisId: job.id,
    status: job.status,
    stage: job.stage,
    progress: {
      completedUnits: job.completedUnits,
      totalUnits: job.totalUnits,
    },
    snapshot: snapshotIdentity(snapshot),
    error:
      job.errorCode && job.errorMessage && job.errorRetryable !== null
        ? {
            code: job.errorCode,
            message: job.errorMessage,
            retryable: job.errorRetryable,
          }
        : null,
  };
}

function mapCreateError(error: unknown): never {
  if (error instanceof TypeError) {
    throw new CreateAnalysisError(400, "invalid_request", error.message);
  }
  if (error instanceof GitHubClientError) {
    if (error.code === "invalid_path")
      throw new CreateAnalysisError(400, "invalid_ref", "The Git reference is invalid.");
    if (error.code === "not_found")
      throw new CreateAnalysisError(404, "repository_not_found", "Repository or ref not found.");
    if (error.code === "rate_limited")
      throw new CreateAnalysisError(
        429,
        "github_rate_limited",
        "GitHub rate limit exceeded. Try again later.",
        error.retryAfterSeconds,
      );
    if (["aborted", "network", "server_error"].includes(error.code))
      throw new CreateAnalysisError(
        503,
        "repository_unavailable",
        "GitHub is temporarily unavailable.",
      );
    throw new CreateAnalysisError(
      502,
      "invalid_provider_response",
      "GitHub returned an invalid response.",
    );
  }
  throw error;
}

async function jobAndSnapshot(analysisId: string, store: AnalysisStore) {
  const job = await store.getAnalysisJob(analysisId);
  if (!job) throw new AnalysisServiceError("not_found", "Analysis not found.");
  const snapshot = await store.getSnapshot(job.snapshotId);
  if (!snapshot) throw new AnalysisServiceError("not_found", "Analysis not found.");
  return { job, snapshot };
}

export function createAnalysisService(dependencies: AnalysisServiceDependencies) {
  return {
    async create(request: Parameters<typeof createAnalysis>[0]): Promise<CreateAnalysisResponse> {
      try {
        const { job, snapshot } = await createAnalysis(request, dependencies.pipeline);
        return {
          ...toAnalysisStatusResponse(job, snapshot),
          capabilityToken: await createCapabilityToken(dependencies.capabilitySecret, job.id),
        };
      } catch (error) {
        mapCreateError(error);
      }
    },

    async status(analysisId: string): Promise<AnalysisStatusResponse> {
      const { job, snapshot } = await jobAndSnapshot(analysisId, dependencies.analysisStore);
      return toAnalysisStatusResponse(job, snapshot);
    },

    async result(analysisId: string): Promise<AnalysisResultResponse> {
      const { job } = await jobAndSnapshot(analysisId, dependencies.analysisStore);
      if (job.status !== "succeeded")
        throw new AnalysisServiceError("not_ready", "Analysis result is not ready.");
      if (!job.resultKey || !job.resultHash)
        throw new AnalysisServiceError("result_unavailable", "Analysis result is unavailable.");
      const artifact = await dependencies.artifactStore.get(job.resultKey);
      if (
        !artifact ||
        artifact.hash !== job.resultHash ||
        (await sha256(artifact.bytes)) !== job.resultHash
      )
        throw new AnalysisServiceError(
          "result_invalid",
          "Analysis result failed integrity verification.",
        );
      try {
        const result = parseAnalysisResult(decodeJson(artifact));
        if (result.jobId !== job.id)
          throw new AnalysisServiceError("result_invalid", "Analysis result failed validation.");
        return { analysisId: job.id, status: "succeeded", result };
      } catch (error) {
        if (error instanceof AnalysisServiceError) throw error;
        throw new AnalysisServiceError("result_invalid", "Analysis result failed validation.");
      }
    },

    async graphQuery(analysisId: string, query: GraphQuery) {
      const response = await this.result(analysisId);
      if (!response.result.graph)
        throw new AnalysisServiceError("result_unavailable", "Analysis graph is unavailable.");
      return {
        analysisId,
        snapshot: response.result.graph.snapshot,
        graphSchemaVersion: response.result.graph.schemaVersion,
        coverage: "coverage" in response.result.graph ? response.result.graph.coverage : null,
        diagnostics:
          "diagnostics" in response.result.graph ? response.result.graph.diagnostics : [],
        result: executeGraphQuery(response.result.graph, query),
      };
    },

    async graphJson(analysisId: string): Promise<string> {
      const response = await this.result(analysisId);
      if (!response.result.graph)
        throw new AnalysisServiceError("result_unavailable", "Analysis graph is unavailable.");
      return canonicalGraphJson(response.result.graph);
    },

    async graphExport(
      analysisId: string,
      format: "json" | "mermaid" | "report" | "html" = "json",
    ): Promise<{ content: string; contentType: string; filename: string }> {
      const response = await this.result(analysisId);
      if (!response.result.graph)
        throw new AnalysisServiceError("result_unavailable", "Analysis graph is unavailable.");
      const g = response.result.graph;
      if (format === "mermaid") {
        return {
          content: codeGraphToMermaid(g),
          contentType: "text/plain; charset=utf-8",
          filename: `analysis-${analysisId}-graph.mmd`,
        };
      }
      if (format === "report") {
        return {
          content: codeGraphToReport(g),
          contentType: "text/markdown; charset=utf-8",
          filename: `analysis-${analysisId}-GRAPH_REPORT.md`,
        };
      }
      if (format === "html") {
        return {
          content: codeGraphToHtml(g),
          contentType: "text/html; charset=utf-8",
          filename: `analysis-${analysisId}-graph.html`,
        };
      }
      return {
        content: canonicalGraphJson(g),
        contentType: "application/json; charset=utf-8",
        filename: `analysis-${analysisId}-graph.json`,
      };
    },

    async answer(analysisId: string, question: string) {
      const response = await this.result(analysisId);
      if (!response.result.graph)
        throw new AnalysisServiceError("result_unavailable", "Analysis graph is unavailable.");
      return {
        analysisId,
        snapshot: response.result.graph.snapshot,
        answer: answerRepositoryQuestion(response.result.graph, question),
      };
    },

    async compareGraphWith(baseAnalysisId: string, targetAnalysisId: string) {
      const baseResponse = await this.result(baseAnalysisId);
      if (!baseResponse.result.graph)
        throw new AnalysisServiceError("result_unavailable", "Base analysis graph is unavailable.");
      const targetResponse = await this.result(targetAnalysisId);
      if (!targetResponse.result.graph)
        throw new AnalysisServiceError(
          "result_unavailable",
          "Target analysis graph is unavailable.",
        );
      return compareCodeGraphs(baseResponse.result.graph, targetResponse.result.graph);
    },

    async prImpact(analysisId: string, changes: PRFileChange[]) {
      const response = await this.result(analysisId);
      if (!response.result.graph)
        throw new AnalysisServiceError("result_unavailable", "Analysis graph is unavailable.");
      return analyzePRImpact(response.result.graph, changes);
    },
  };
}
