import type { Repo } from "../domain/repository.ts";
import type { Model } from "../domain/repository-model.ts";
import { codeExtensions, extensionOf } from "./file-classification.ts";

export function buildModel(repo: Repo): Model {
  const paths = repo.sampleFiles || [];
  const top = new Map<string, number>();
  const extensions = new Map<string, number>();
  for (const path of paths) {
    const first = path.split("/")[0] || "root";
    top.set(first, (top.get(first) || 0) + 1);
    const extension = extensionOf(path);
    extensions.set(extension, (extensions.get(extension) || 0) + 1);
  }
  const sourceFiles = paths.filter((path) => codeExtensions.has(extensionOf(path)));
  const testFiles = paths.filter((path) => /(test|spec|__tests__)/i.test(path));
  const configFiles = paths.filter((path) =>
    /(package\.json|tsconfig|vite\.config|next\.config|dockerfile|compose|\.ya?ml$|\.toml$|\.env)/i.test(
      path,
    ),
  );
  const docs = paths.filter((path) =>
    /(readme|contributing|architecture|docs\/|security\.md)/i.test(path),
  );
  const workflows = paths.filter((path) =>
    /\.github\/workflows|\.gitlab-ci|bitbucket-pipelines/i.test(path),
  );
  const hasLock = paths.some((path) =>
    /(package-lock|pnpm-lock|yarn\.lock|poetry\.lock|go\.sum|cargo\.lock)/i.test(path),
  );
  const hasSecurity = paths.some((path) => /security\.md$/i.test(path));
  const hasEnv = paths.find((path) => /(^|\/)\.env$/i.test(path));
  const hasTests = testFiles.length > 0;
  const hasCI = workflows.length > 0;
  const security = [
    ...(hasEnv
      ? [
          {
            level: "High",
            title: "Environment file is indexed",
            detail: "Review it for secrets and remove it from version control.",
            file: hasEnv,
          },
        ]
      : []),
    ...(!hasSecurity
      ? [
          {
            level: "Medium",
            title: "No SECURITY.md found",
            detail: "The repository has no visible vulnerability reporting policy.",
          },
        ]
      : []),
    ...(!hasLock
      ? [
          {
            level: "Medium",
            title: "No dependency lockfile detected",
            detail: "Dependency resolution may not be reproducible.",
          },
        ]
      : []),
    ...(!hasCI
      ? [
          {
            level: "Low",
            title: "No CI workflow detected",
            detail: "Automated security and quality checks were not found.",
          },
        ]
      : []),
  ];
  if (!security.length) {
    security.push({
      level: "Info",
      title: "No path-level security warnings",
      detail: "Content-aware SAST is required before declaring the code secure.",
    });
  }
  const biggest = [...top.entries()].sort((left, right) => right[1] - left[1])[0];
  const risks = [
    ...(biggest && biggest[1] > Math.max(20, paths.length * 0.55)
      ? [
          {
            title: "Repository concentration",
            detail: `${biggest[0]} contains ${biggest[1]} of ${paths.length} indexed paths.`,
            score: 72,
            file: biggest[0],
          },
        ]
      : []),
    ...(!hasTests
      ? [
          {
            title: "No tests detected",
            detail: "No test/spec paths were identified in the indexed tree.",
            score: 81,
          },
        ]
      : []),
    ...(sourceFiles.length > 200 && testFiles.length < sourceFiles.length * 0.05
      ? [
          {
            title: "Low test proximity",
            detail: `${sourceFiles.length} source files map to only ${testFiles.length} test files.`,
            score: 68,
          },
        ]
      : []),
  ];
  if (!risks.length) {
    risks.push({
      title: "No structural hotspot detected",
      detail:
        "The repository tree is reasonably distributed. Symbol-level analysis may reveal deeper coupling.",
      score: 22,
    });
  }
  const recommendations = [
    ...(!hasTests
      ? [
          {
            priority: "P0",
            title: "Add a baseline test suite",
            reason: "No test files were found in this repository.",
          },
        ]
      : []),
    ...(!hasCI
      ? [
          {
            priority: "P1",
            title: "Add continuous integration",
            reason: "No provider workflow was found.",
          },
        ]
      : []),
    ...(!hasSecurity
      ? [
          {
            priority: "P1",
            title: "Create a security policy",
            reason: "Contributors need a private vulnerability-reporting path.",
          },
        ]
      : []),
    ...(hasEnv
      ? [
          {
            priority: "P0",
            title: "Remove committed environment secrets",
            reason: `${hasEnv} should not be versioned.`,
          },
        ]
      : []),
    {
      priority: "P2",
      title: "Document the project architecture",
      reason: docs.length
        ? `Build on the ${docs.length} existing documentation files.`
        : "No architecture documentation was detected.",
    },
  ];
  return {
    topDirs: [...top.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 12)
      .map(([name, count]) => ({ name, count })),
    extensions: [...extensions.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count })),
    sourceFiles,
    testFiles,
    configFiles,
    docs,
    workflows,
    security,
    risks,
    recommendations,
  };
}
