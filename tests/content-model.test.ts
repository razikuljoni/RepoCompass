import assert from "node:assert/strict";
import test from "node:test";
import { contentModel } from "../lib/analysis/content-model.ts";
import type { Repo } from "../lib/domain/repository.ts";

const repo: Repo = {
  owner: "example",
  name: "project",
  provider: "Local folder",
  branch: "working-tree",
  files: 4,
  ignored: 0,
  bytes: 500,
  languages: [{ name: "ts", count: 2 }],
  sampleFiles: ["src/app.ts", "src/User.ts", "package.json", "tests/app.test.ts"],
  indexedFiles: [
    {
      path: "src/app.ts",
      content: [
        'import { User } from "./User";',
        'const express = require("express");',
        'app.get("/users", handler);',
        'const token = "production-secret";',
      ].join("\n"),
    },
    { path: "src/User.ts", content: "export class User {}" },
    {
      path: "package.json",
      content: JSON.stringify({
        dependencies: { react: "1" },
        devDependencies: { typescript: "1" },
      }),
    },
  ],
  source: "local",
};

test("adapts extracted repository content into the existing UI model", () => {
  const model = contentModel(repo);
  assert.deepStrictEqual(model.edges, [
    { from: "src/app.ts", to: "./User", kind: "import" },
    { from: "src/app.ts", to: "express", kind: "require" },
  ]);
  assert.deepStrictEqual(model.routes, [{ method: "GET", path: "/users", file: "src/app.ts" }]);
  assert.deepStrictEqual(model.dependencies, ["express", "react", "typescript"]);
  assert.deepStrictEqual(model.terms, [
    { term: "User", detail: "class defined in this repository", evidence: "src/User.ts:1" },
  ]);
  assert.equal(
    model.security.some((finding) => finding.title === "Possible hard-coded credential"),
    true,
  );
});

test("silently ignores malformed package manifests", () => {
  const model = contentModel({
    ...repo,
    indexedFiles: [{ path: "package.json", content: "{" }],
  });
  assert.deepStrictEqual(model.dependencies, []);
});
