export type Artifact = {
  key: string;
  hash: string;
  bytes: Uint8Array;
};

export class ArtifactConflictError extends Error {
  constructor(key: string) {
    super(`Artifact already exists with different bytes: ${key}`);
    this.name = "ArtifactConflictError";
  }
}

export class ArtifactIntegrityError extends Error {
  constructor(key: string) {
    super(`Artifact hash verification failed: ${key}`);
    this.name = "ArtifactIntegrityError";
  }
}

export interface ArtifactStore {
  put(key: string, bytes: Uint8Array): Promise<Artifact>;
  get(key: string): Promise<Artifact | null>;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const input = bytes.slice();
  const digest = await crypto.subtle.digest("SHA-256", input.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function artifactKey(kind: "manifest" | "blob" | "result", identity: string): string {
  if (!identity || identity.startsWith("/") || identity.includes("..")) {
    throw new TypeError("Artifact identity must be non-empty and path-safe");
  }
  return `${kind}/${identity}`;
}

export function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

export function decodeJson<T>(artifact: Artifact): T {
  return JSON.parse(new TextDecoder().decode(artifact.bytes)) as T;
}

function immutableCopy(artifact: Artifact): Artifact {
  return { ...artifact, bytes: artifact.bytes.slice() };
}

export class InMemoryArtifactStore implements ArtifactStore {
  private readonly artifacts = new Map<string, Artifact>();

  async put(key: string, bytes: Uint8Array): Promise<Artifact> {
    const storedBytes = bytes.slice();
    const hash = await sha256(storedBytes);
    const existing = this.artifacts.get(key);
    if (existing) {
      if (existing.hash !== hash) throw new ArtifactConflictError(key);
      return immutableCopy(existing);
    }
    const artifact = { key, hash, bytes: storedBytes };
    this.artifacts.set(key, artifact);
    return immutableCopy(artifact);
  }

  async get(key: string): Promise<Artifact | null> {
    const artifact = this.artifacts.get(key);
    if (!artifact) return null;
    if ((await sha256(artifact.bytes)) !== artifact.hash) throw new ArtifactIntegrityError(key);
    return immutableCopy(artifact);
  }
}
