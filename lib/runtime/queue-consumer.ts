import {
  parseAnalysisQueueMessage,
  type AnalysisJobError,
  type AnalysisQueueMessageV1,
} from "../domain/analysis-job.ts";
import { processAnalysisMessage, type JobPipelineDependencies } from "../jobs/pipeline.ts";
import { GitHubClientError } from "../providers/github-client.ts";

export type RuntimeQueueMessage = {
  readonly body: unknown;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};

export type RuntimeQueueBatch = {
  readonly messages: readonly RuntimeQueueMessage[];
};

function decodeMessage(body: unknown): AnalysisQueueMessageV1 {
  if (typeof body !== "string") return parseAnalysisQueueMessage(body);
  try {
    return parseAnalysisQueueMessage(JSON.parse(body));
  } catch {
    return parseAnalysisQueueMessage(body);
  }
}

function failure(error: unknown): AnalysisJobError | null {
  if (!(error instanceof GitHubClientError)) {
    if (error instanceof Error) {
      return { code: "analysis_failed", message: error.message, retryable: false };
    }
    return { code: "analysis_failed", message: "Analysis processing failed.", retryable: false };
  }
  if (error.code === "not_found") {
    return { code: "repository_not_found", message: error.message, retryable: false };
  }
  if (error.code === "rate_limited") {
    return {
      code: "github_rate_limited",
      message: "GitHub API rate limit exceeded. Configure GITHUB_TOKEN in Worker secrets.",
      retryable: false,
    };
  }
  if (["aborted", "network", "server_error"].includes(error.code)) return null;
  return { code: "invalid_provider_response", message: error.message, retryable: false };
}

async function markFailed(
  queueMessage: AnalysisQueueMessageV1,
  error: AnalysisJobError,
  dependencies: JobPipelineDependencies,
): Promise<void> {
  const job = await dependencies.analysisStore.getAnalysisJob(queueMessage.jobId);
  if (!job || ["succeeded", "failed", "cancelled"].includes(job.status)) return;
  await dependencies.analysisStore.compareAndSetAnalysisJob(
    job.id,
    { status: job.status, stage: job.stage, cursor: job.cursor },
    {
      status: "failed",
      error,
      attemptCount: job.attemptCount + 1,
      finishedAt: dependencies.clock().toISOString(),
      updatedAt: dependencies.clock().toISOString(),
    },
  );
}

export function createAnalysisQueueConsumer(dependencies: JobPipelineDependencies) {
  return async (batch: RuntimeQueueBatch): Promise<void> => {
    console.log("CONSUMING QUEUE BATCH COUNT:", batch.messages.length);
    await Promise.all(
      batch.messages.map(async (delivery) => {
        let queueMessage: AnalysisQueueMessageV1;
        try {
          queueMessage = decodeMessage(delivery.body);
        } catch (err) {
          console.error("QUEUE MESSAGE DECODE ERROR:", err, "BODY:", delivery.body);
          delivery.ack();
          return;
        }
        try {
          await processAnalysisMessage(queueMessage, dependencies);
          delivery.ack();
        } catch (error) {
          console.error("QUEUE PROCESS MESSAGE ERROR:", error, "JOB:", queueMessage.jobId);
          let jobError = failure(error);
          if (!jobError) {
            const currentJob = await dependencies.analysisStore
              .getAnalysisJob(queueMessage.jobId)
              .catch(() => null);
            if (currentJob && currentJob.attemptCount >= 3) {
              const msg =
                error instanceof Error ? error.message : "Analysis failed after maximum retries.";
              jobError = { code: "analysis_failed", message: msg, retryable: false };
            }
          }
          if (!jobError) {
            const delaySeconds =
              error instanceof GitHubClientError ? error.retryAfterSeconds : undefined;
            delivery.retry(delaySeconds === undefined ? undefined : { delaySeconds });
            return;
          }
          try {
            await markFailed(queueMessage, jobError, dependencies);
            delivery.ack();
          } catch (markErr) {
            console.error("MARK FAILED ERROR:", markErr);
            delivery.retry();
          }
        }
      }),
    );
  };
}
