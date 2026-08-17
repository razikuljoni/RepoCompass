import { createAnalysisDependencies, type AnalysisEnvironment } from "./analysis-factory.ts";
import { createAnalysisQueueConsumer, type RuntimeQueueBatch } from "./queue-consumer.ts";

export type AnalysisQueueEnvironment = AnalysisEnvironment;

export type AnalysisQueueRuntime = {
  consume(batch: RuntimeQueueBatch, env: AnalysisQueueEnvironment): Promise<void>;
};

export const analysisQueueRuntime: AnalysisQueueRuntime = {
  async consume(batch, env): Promise<void> {
    await createAnalysisQueueConsumer(createAnalysisDependencies(env).pipeline)(batch);
  },
};
