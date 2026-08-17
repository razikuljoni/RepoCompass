import { sha256 } from "../persistence/artifact-store.ts";
import { D1AnalysisStore, type D1Binding } from "../persistence/d1-analysis-store.ts";
import { R2ArtifactStore, type R2Binding } from "../persistence/r2-artifact-store.ts";
import { createGitHubClient } from "../providers/github-client.ts";

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
  if (!env.CAPABILITY_SECRET) throw new Error("CAPABILITY_SECRET is required");
  const analysisStore = new D1AnalysisStore(env.DB);
  const artifactStore = new R2ArtifactStore(env.ARTIFACTS);
  const pipeline = {
    analysisStore,
    artifactStore,
    github: createGitHubClient({
      fetch,
      token: env.GITHUB_TOKEN,
      userAgent: "RepoCompass-Worker/0.1",
    }),
    queue: {
      send: async (message: unknown) => {
        await env.ANALYSIS_QUEUE.send(message);
      },
    },
    analyzerVersion: "phase-1a.1",
    clock: () => new Date(),
    hash,
  };
  return { analysisStore, artifactStore, pipeline, capabilitySecret: env.CAPABILITY_SECRET };
}
