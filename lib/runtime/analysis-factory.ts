import { sha256 } from "../persistence/artifact-store.ts";
import { D1AnalysisStore, type D1Binding } from "../persistence/d1-analysis-store.ts";
import { R2ArtifactStore, type R2Binding } from "../persistence/r2-artifact-store.ts";
import { createGitHubClient } from "../providers/github-client.ts";
import { analysisQueueRuntime } from "./analysis-queue.ts";

export type AnalysisEnvironment = {
  DB: D1Binding;
  ARTIFACTS: R2Binding;
  ANALYSIS_QUEUE: { send(message: unknown): Promise<unknown> };
  GITHUB_TOKEN?: string;
  CAPABILITY_SECRET?: string;
};

async function hash(value: string | Uint8Array): Promise<string> {
  return sha256(typeof value === "string" ? new TextEncoder().encode(value) : value);
}

export function createAnalysisDependencies(env: AnalysisEnvironment) {
  const capabilitySecret =
    env.CAPABILITY_SECRET ??
    (typeof process !== "undefined" ? process.env?.CAPABILITY_SECRET : undefined) ??
    "repocompass-dev-capability-secret-key-32b";
  const analysisStore = new D1AnalysisStore(env.DB);
  const artifactStore = new R2ArtifactStore(env.ARTIFACTS);
  const pipeline = {
    analysisStore,
    artifactStore,
    github: createGitHubClient({
      fetch,
      token:
        env.GITHUB_TOKEN ??
        (typeof process !== "undefined" ? process.env?.GITHUB_TOKEN : undefined),
      userAgent: "RepoCompass-Worker/0.1",
    }),
    queue: {
      send: async (message: unknown) => {
        if (env.ANALYSIS_QUEUE?.send) {
          await env.ANALYSIS_QUEUE.send(message);
        }
        if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
          setTimeout(() => {
            const batch = {
              queue: "repo-compass-analysis-production",
              messages: [
                {
                  id: `dev-${Date.now()}`,
                  body: message,
                  attempts: 1,
                  timestamp: new Date(),
                  ack() {},
                  retry() {},
                },
              ],
              ackAll() {},
              retryAll() {},
            };
            analysisQueueRuntime.consume(batch, env).catch((error) => {
              console.error("DEV QUEUE CONSUMER ERROR:", error);
            });
          }, 0);
        }
      },
    },
    analyzerVersion: "phase-2.1",
    clock: () => new Date(),
    hash,
  };
  return { analysisStore, artifactStore, pipeline, capabilitySecret };
}
