import { env } from "cloudflare:workers";
import { createAnalysisDependencies } from "@/lib/runtime/analysis-factory";
import { apiError, isAuthorized, readSmallJson } from "@/lib/runtime/analysis-http";
import { AnalysisServiceError, createAnalysisService } from "@/lib/runtime/analysis-service";

function questionFrom(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Request body must be an object.");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== "question")) {
    throw new TypeError("Request body contains unsupported fields.");
  }
  if (typeof input.question !== "string") throw new TypeError("question must be a string.");
  return input.question;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ analysisId: string }> },
): Promise<Response> {
  const { analysisId } = await context.params;
  const dependencies = createAnalysisDependencies(env);
  if (
    !(await isAuthorized(
      request.headers.get("authorization"),
      dependencies.capabilitySecret,
      analysisId,
    ))
  ) {
    return Response.json(apiError("unauthorized", "A valid capability token is required."), {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer", "Cache-Control": "no-store" },
    });
  }
  try {
    const question = questionFrom(await readSmallJson(request));
    const response = await createAnalysisService(dependencies).answer(analysisId, question);
    return Response.json(response, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof TypeError || error instanceof SyntaxError || error instanceof RangeError) {
      return Response.json(apiError("invalid_request", error.message), { status: 400 });
    }
    if (error instanceof AnalysisServiceError) {
      const status = error.code === "not_found" ? 404 : error.code === "not_ready" ? 409 : 500;
      return Response.json(apiError(error.code, error.message), { status });
    }
    return Response.json(apiError("internal_error", "Unable to answer repository question."), {
      status: 500,
    });
  }
}
