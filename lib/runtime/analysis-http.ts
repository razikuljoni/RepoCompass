import { bearerToken, verifyCapabilityToken } from "./capability.ts";

export const maximumCreateAnalysisBodyBytes = 16_384;

export type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

export function apiError(code: string, message: string): ApiErrorResponse {
  return { error: { code, message } };
}

export function isSameOrigin(requestUrl: string, origin: string | null): boolean {
  if (origin === null) return true;
  try {
    return new URL(origin).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

export async function readSmallJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type") !== "application/json") {
    throw new TypeError("Content-Type must be application/json.");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > maximumCreateAnalysisBodyBytes)
      throw new RangeError("Request body is too large.");
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maximumCreateAnalysisBodyBytes)
    throw new RangeError("Request body is too large.");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new SyntaxError("Request body must be valid JSON.");
  }
}

export async function isAuthorized(
  authorization: string | null,
  secret: string,
  analysisId: string,
): Promise<boolean> {
  const token = bearerToken(authorization);
  return token !== null && (await verifyCapabilityToken(secret, analysisId, token));
}
