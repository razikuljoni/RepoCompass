import assert from "node:assert/strict";
import test from "node:test";
import {
  ArtifactConflictError,
  InMemoryArtifactStore,
  artifactKey,
  decodeJson,
  encodeJson,
} from "../lib/persistence/artifact-store.ts";

test("artifact writes and reads are immutable", async () => {
  const store = new InMemoryArtifactStore();
  const key = artifactKey("blob", "github/abc");
  const input = new Uint8Array([1, 2, 3]);
  const stored = await store.put(key, input);

  input[0] = 9;
  stored.bytes[1] = 9;
  const firstRead = await store.get(key);
  assert.deepStrictEqual(firstRead?.bytes, new Uint8Array([1, 2, 3]));

  firstRead!.bytes[2] = 9;
  assert.deepStrictEqual((await store.get(key))?.bytes, new Uint8Array([1, 2, 3]));
});

test("same key and bytes is idempotent", async () => {
  const store = new InMemoryArtifactStore();
  const key = artifactKey("manifest", "snapshot-1");
  const first = await store.put(key, new Uint8Array([4, 5, 6]));
  const second = await store.put(key, new Uint8Array([4, 5, 6]));

  assert.deepStrictEqual(second, first);
});

test("same key with different bytes is rejected without overwrite", async () => {
  const store = new InMemoryArtifactStore();
  const key = artifactKey("result", "job-1/v1");
  await store.put(key, new Uint8Array([1]));

  await assert.rejects(store.put(key, new Uint8Array([2])), ArtifactConflictError);
  assert.deepStrictEqual((await store.get(key))?.bytes, new Uint8Array([1]));
});

test("JSON helpers preserve structured artifacts", async () => {
  const store = new InMemoryArtifactStore();
  const artifact = await store.put(artifactKey("result", "job-1/json"), encodeJson({ ok: true }));

  assert.deepStrictEqual(decodeJson(artifact), { ok: true });
});
