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
  return parseAnalysisQueueMessage(JSON.parse(body));
}

function failure(error: unknown): AnalysisJobError | null {
  if (!(error instanceof GitHubClientError)) return null;
  if (["aborted", "network", "rate_limited", "server_error"].includes(error.code)) return null;
  if (error.code === "not_found") {
    return { code: "repository_not_found", message: error.message, retryable: false };
  }
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
    await Promise.all(
      batch.messages.map(async (delivery) => {
        let queueMessage: AnalysisQueueMessageV1;
        try {
          queueMessage = decodeMessage(delivery.body);
        } catch {
          delivery.ack();
          return;
        }
        try {
          await processAnalysisMessage(queueMessage, dependencies);
          delivery.ack();
        } catch (error) {
          const jobError = failure(error);
          if (!jobError) {
            const delaySeconds =
              error instanceof GitHubClientError ? error.retryAfterSeconds : undefined;
            delivery.retry(delaySeconds === undefined ? undefined : { delaySeconds });
            return;
          }
          try {
            await markFailed(queueMessage, jobError, dependencies);
            delivery.ack();
          } catch {
            delivery.retry();
          }
        }
      }),
    );
  };
}
