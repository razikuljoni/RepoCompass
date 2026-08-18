import { env } from "cloudflare:workers";
import type { PRFileChange } from "@/lib/analysis/pr-intelligence";
import { createAnalysisDependencies } from "@/lib/runtime/analysis-factory";
import { parseCapabilityTokenFromHeader } from "@/lib/runtime/analysis-http";
import { createAnalysisService } from "@/lib/runtime/analysis-service";

export async function POST(
  request: Request,
  props: { params: Promise<{ analysisId: string }> },
): Promise<Response> {
  const { analysisId } = await props.params;
  const token = parseCapabilityTokenFromHeader(request.headers.get("authorization"));
  if (!token) {
    return Response.json(
      { error: { code: "unauthorized", message: "Capability token required." } },
      { status: 401, headers: { "cache-control": "no-store, private" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { code: "invalid_request", message: "Request body must be valid JSON." } },
      { status: 400, headers: { "cache-control": "no-store, private" } },
    );
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("changes" in body) ||
    !Array.isArray(body.changes)
  ) {
    return Response.json(
      { error: { code: "invalid_request", message: "Request body must contain 'changes' array." } },
      { status: 400, headers: { "cache-control": "no-store, private" } },
    );
  }

  const changes = body.changes as PRFileChange[];
  const service = createAnalysisService(createAnalysisDependencies(env));
  try {
    await service.verifyAccess(analysisId, token);
    const report = await service.prImpact(analysisId, changes);
    return Response.json(report, {
      headers: { "cache-control": "no-store, private" },
    });
  } catch (err: unknown) {
    const error = err as { code?: string; message?: string };
    const code = error.code || "internal_error";
    const status = code === "unauthorized" ? 401 : code === "not_found" ? 404 : 400;
    return Response.json(
      { error: { code, message: error.message || "Failed to analyze PR impact." } },
      { status, headers: { "cache-control": "no-store, private" } },
    );
  }
}
