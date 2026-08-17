const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

async function signature(secret: string, analysisId: string): Promise<string> {
  if (!secret) throw new Error("CAPABILITY_SECRET is required");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(analysisId));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function createCapabilityToken(secret: string, analysisId: string): Promise<string> {
  if (!analysisId) throw new TypeError("analysisId is required");
  return signature(secret, analysisId);
}

export async function verifyCapabilityToken(
  secret: string,
  analysisId: string,
  token: string,
): Promise<boolean> {
  if (!analysisId || !token) return false;
  return constantTimeEqual(await signature(secret, analysisId), token);
}

export function bearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization);
  return match?.[1] ?? null;
}
