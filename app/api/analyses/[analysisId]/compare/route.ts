import { env } from "cloudflare:workers";
import { createAnalysisDependencies } from "@/lib/runtime/analysis-factory";
import { apiError, isAuthorized } from "@/lib/runtime/analysis-http";
import { AnalysisServiceError, createAnalysisService } from "@/lib/runtime/analysis-service";

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(apiError("invalid_request", "A valid JSON request body is required."), {
      status: 400,
    });
  }

  if (
    typeof body !== "object" ||
    !body ||
    !("targetAnalysisId" in body) ||
    typeof (body as { targetAnalysisId: unknown }).targetAnalysisId !== "string"
  ) {
    return Response.json(
      apiError("invalid_request", "The request body must include targetAnalysisId string."),
      { status: 400 },
    );
  }

  const { targetAnalysisId } = body as { targetAnalysisId: string };

  try {
    const diff = await createAnalysisService(dependencies).compareGraphWith(
      analysisId,
      targetAnalysisId,
    );
    return Response.json(diff, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AnalysisServiceError) {
      const status = error.code === "not_found" ? 404 : error.code === "not_ready" ? 409 : 500;
      return Response.json(apiError(error.code, error.message), { status });
    }
    return Response.json(apiError("internal_error", "Unable to compare analysis graphs."), {
      status: 500,
    });
  }
}
