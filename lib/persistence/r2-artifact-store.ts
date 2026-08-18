import {
  ArtifactConflictError,
  ArtifactIntegrityError,
  sha256,
  type Artifact,
  type ArtifactStore,
} from "./artifact-store.ts";

export interface R2ObjectBody {
  arrayBuffer(): Promise<ArrayBuffer>;
  customMetadata?: Record<string, string>;
}

export interface R2PutOptions {
  customMetadata?: Record<string, string>;
  onlyIf?: { etagDoesNotMatch?: string };
}

export interface R2Binding {
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: Uint8Array | ArrayBuffer,
    options?: R2PutOptions,
  ): Promise<unknown | null>;
}

export class R2ArtifactStore implements ArtifactStore {
  constructor(private readonly bucket: R2Binding) {}

  async put(key: string, bytes: Uint8Array): Promise<Artifact> {
    console.log("R2 PUT START:", key, "BYTES:", bytes.length);
    const storedBytes = bytes.slice();
    const [hash, existing] = await Promise.all([sha256(storedBytes), this.get(key)]);
    if (existing) {
      console.log("R2 EXISTING HIT:", key);
      if (existing.hash !== hash) throw new ArtifactConflictError(key);
      return existing;
    }
    console.log("R2 CALLING BUCKET.PUT:", key);
    try {
      await this.bucket.put(key, storedBytes, {
        customMetadata: { sha256: hash },
      });
    } catch (r2Err) {
      console.error("R2 BUCKET.PUT ERROR:", r2Err);
      throw r2Err;
    }
    console.log("R2 BUCKET.PUT OK:", key);
    const written = await this.get(key);
    if (!written || written.hash !== hash) throw new ArtifactIntegrityError(key);
    return written;
  }

  async get(key: string): Promise<Artifact | null> {
    const object = await this.bucket.get(key);
    if (!object) return null;
    const bytes = new Uint8Array(await object.arrayBuffer());
    const hash = await sha256(bytes);
    if (object.customMetadata?.sha256 !== hash) throw new ArtifactIntegrityError(key);
    return { key, hash, bytes: bytes.slice() };
  }
}
