import assert from "node:assert/strict";
import test from "node:test";
import {
  bearerToken,
  createCapabilityToken,
  verifyCapabilityToken,
} from "../lib/runtime/capability.ts";

test("capability tokens are deterministic, job-bound, and verifiable", async () => {
  const token = await createCapabilityToken("test-secret", "job_123");
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(token, await createCapabilityToken("test-secret", "job_123"));
  assert.equal(await verifyCapabilityToken("test-secret", "job_123", token), true);
  assert.equal(await verifyCapabilityToken("test-secret", "job_124", token), false);
  assert.equal(await verifyCapabilityToken("other-secret", "job_123", token), false);
  assert.equal(await verifyCapabilityToken("test-secret", "job_123", `${token}x`), false);
});

test("bearer parsing is strict", () => {
  assert.equal(bearerToken("Bearer abc_123-xyz"), "abc_123-xyz");
  assert.equal(bearerToken("bearer abc"), null);
  assert.equal(bearerToken("Bearer abc extra"), null);
  assert.equal(bearerToken(null), null);
});
