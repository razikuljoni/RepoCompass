import { handleMcpRequest, type JsonRpcRequest } from "@/lib/mcp/mcp-server";
import { parseCapabilityTokenFromHeader } from "@/lib/runtime/analysis-http";
import { createAnalysisService } from "@/lib/runtime/analysis-service";

export async function POST(request: Request): Promise<Response> {
  const token = parseCapabilityTokenFromHeader(request.headers.get("authorization"));
  const url = new URL(request.url);
  const analysisId = url.searchParams.get("analysisId");

  if (!token || !analysisId) {
    return Response.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message:
            "Unauthorized. 'authorization' bearer token and 'analysisId' query parameter required.",
        },
      },
      { status: 401, headers: { "cache-control": "no-store, private" } },
    );
  }

  let rpcRequest: JsonRpcRequest;
  try {
    rpcRequest = (await request.json()) as JsonRpcRequest;
  } catch {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32700, message: "Parse error. Invalid JSON." } },
      { status: 400, headers: { "cache-control": "no-store, private" } },
    );
  }

  if (
    !rpcRequest ||
    typeof rpcRequest !== "object" ||
    rpcRequest.jsonrpc !== "2.0" ||
    !rpcRequest.method
  ) {
    return Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32600, message: "Invalid Request. Must be JSON-RPC 2.0." },
      },
      { status: 400, headers: { "cache-control": "no-store, private" } },
    );
  }

  const service = createAnalysisService();
  try {
    await service.verifyAccess(analysisId, token);
    const resultResponse = await service.result(analysisId);
    if (!resultResponse.result.graph) {
      return Response.json(
        {
          jsonrpc: "2.0",
          id: rpcRequest.id,
          error: { code: -32002, message: "Analysis graph unavailable." },
        },
        { status: 404, headers: { "cache-control": "no-store, private" } },
      );
    }

    const rpcResponse = handleMcpRequest(resultResponse.result.graph, rpcRequest);
    return Response.json(rpcResponse, {
      headers: { "cache-control": "no-store, private" },
    });
  } catch (err: unknown) {
    const error = err as { code?: string; message?: string };
    return Response.json(
      {
        jsonrpc: "2.0",
        id: rpcRequest.id,
        error: { code: -32000, message: error.message || "MCP server internal error." },
      },
      { status: 500, headers: { "cache-control": "no-store, private" } },
    );
  }
}
