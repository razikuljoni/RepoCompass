import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production analysis dependencies use the phase 2 analyzer version", async () => {
  const source = await readFile(
    new URL("../lib/runtime/analysis-factory.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /analyzerVersion: "phase-2\.1"/);
  assert.doesNotMatch(source, /analyzerVersion: "phase-1a\.1"/);
});
