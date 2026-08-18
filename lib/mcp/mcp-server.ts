import { executeGraphQuery } from "../analysis/graph-query-engine.ts";
import { parseGraphQuery } from "../analysis/graph-query-contract.ts";
import { analyzePRImpact, type PRFileChange } from "../analysis/pr-intelligence.ts";
import { answerRepositoryQuestion } from "../analysis/repository-question-engine.ts";
import type { CodeGraph } from "../domain/code-graph.ts";

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export const mcpToolsDefinition = [
  {
    name: "repocompass_query",
    description:
      "Execute a graph query (search, node, neighbors, shortestPath, explain) against RepoCompass CodeGraph",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["search", "node", "neighbors", "shortestPath", "explain"],
        },
        query: { type: "string" },
        nodeId: { type: "string" },
        targetNodeId: { type: "string" },
        direction: { type: "string", enum: ["incoming", "outgoing", "both"] },
        maxDepth: { type: "number" },
      },
      required: ["operation"],
    },
  },
  {
    name: "repocompass_answer",
    description:
      "Ask a question about the repository and receive grounded factual claims with commit-pinned citations",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string" },
      },
      required: ["question"],
    },
  },
  {
    name: "repocompass_pr_impact",
    description:
      "Analyze the blast radius, affected routes, and risk score for a set of PR file changes",
    inputSchema: {
      type: "object",
      properties: {
        changes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              status: { type: "string", enum: ["added", "modified", "deleted"] },
            },
            required: ["path", "status"],
          },
        },
      },
      required: ["changes"],
    },
  },
];

export function handleMcpRequest(graph: CodeGraph, request: JsonRpcRequest): JsonRpcResponse {
  const { id, method, params } = request;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "repocompass-mcp", version: "0.1.0" },
      },
    };
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: { tools: mcpToolsDefinition },
    };
  }

  if (method === "tools/call") {
    const toolName = params?.name as string;
    const toolArgs = (params?.arguments as Record<string, unknown>) || {};

    if (toolName === "repocompass_query") {
      try {
        const query = parseGraphQuery(toolArgs);
        const result = executeGraphQuery(graph, query);
        return {
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
        };
      } catch (err: unknown) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: (err as Error).message || "Invalid query parameters" },
        };
      }
    }

    if (toolName === "repocompass_answer") {
      const question = (toolArgs.question as string) || "";
      if (!question || typeof question !== "string") {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "Parameter 'question' must be a non-empty string" },
        };
      }

      const answer = answerRepositoryQuestion(graph, question);
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(answer, null, 2) }] },
      };
    }

    if (toolName === "repocompass_pr_impact") {
      const changes = (toolArgs.changes as PRFileChange[]) || [];
      const impact = analyzePRImpact(graph, changes);
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(impact, null, 2) }] },
      };
    }

    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Tool not found: ${toolName}` },
    };
  }

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}
