import { env } from "cloudflare:workers";
import { parseCreateAnalysisJobRequest } from "@/lib/domain/analysis-job";
import { createAnalysisDependencies } from "@/lib/runtime/analysis-factory";
import { apiError, isSameOrigin, readSmallJson } from "@/lib/runtime/analysis-http";
import { CreateAnalysisError, createAnalysisService } from "@/lib/runtime/analysis-service";

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request.url, request.headers.get("origin"))) {
    return Response.json(apiError("forbidden_origin", "Origin is not allowed."), { status: 403 });
  }
  try {
    const input = parseCreateAnalysisJobRequest(await readSmallJson(request));
    const service = createAnalysisService(createAnalysisDependencies(env));
    const response = await service.create(input);
    return Response.json(response, {
      status: 202,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof RangeError) {
      return Response.json(apiError("request_too_large", error.message), { status: 413 });
    }
    if (error instanceof TypeError || error instanceof SyntaxError) {
      return Response.json(apiError("invalid_request", error.message), { status: 400 });
    }
    if (error instanceof CreateAnalysisError) {
      const headers =
        error.retryAfterSeconds === undefined
          ? undefined
          : { "Retry-After": String(error.retryAfterSeconds) };
      return Response.json(apiError(error.code, error.message), { status: error.status, headers });
    }
    return Response.json(apiError("internal_error", "Unable to create analysis."), { status: 500 });
  }
}
