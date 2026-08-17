import type { Repo } from "../domain/repository.ts";
import type { RepositoryGraph } from "../domain/repository-graph.ts";

export function buildRepositoryGraph(repo: Repo): RepositoryGraph {
  const edges: RepositoryGraph["edges"] = [];
  const symbols: RepositoryGraph["symbols"] = [];
  const routes: RepositoryGraph["routes"] = [];
  const dependencies = new Set<string>();
  const terms: RepositoryGraph["terms"] = [];
  const security: RepositoryGraph["security"] = [];
  for (const file of repo.indexedFiles || []) {
    if (!file.content) continue;
    const lines = file.content.split("\n");
    lines.forEach((line, index) => {
      const imports = [...line.matchAll(/(?:from\s+|require\s*\(\s*)["']([^"']+)/g)];
      for (const match of imports) {
        edges.push({
          from: file.path,
          to: match[1],
          kind: line.includes("require") ? "require" : "import",
        });
        if (!match[1].startsWith(".") && !match[1].startsWith("/")) {
          dependencies.add(
            match[1]
              .split("/")
              .slice(0, match[1].startsWith("@") ? 2 : 1)
              .join("/"),
          );
        }
      }
      const symbol = line.match(
        /(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let)\s+([A-Za-z_$][\w$]*)/,
      );
      if (symbol) {
        symbols.push({
          name: symbol[1],
          kind: (line.match(/function|class|interface|type|const|let/) || ["symbol"])[0],
          file: file.path,
          line: index + 1,
        });
      }
      const route = line.match(
        /(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)/i,
      );
      if (route) {
        routes.push({ method: route[1].toUpperCase(), path: route[2], file: file.path });
      }
      if (
        /(?:password|token|secret|api[_-]?key)\s*[:=]\s*["'][^"']{8,}["']/i.test(line) &&
        !/(process\.env|import\.meta\.env|example|placeholder|test)/i.test(line)
      ) {
        security.push({
          level: "High",
          title: "Possible hard-coded credential",
          detail: "A credential-like literal was detected. Confirm before remediation.",
          file: file.path,
          line: index + 1,
        });
      }
      if (/\beval\s*\(|new Function\s*\(/.test(line)) {
        security.push({
          level: "High",
          title: "Dynamic code execution",
          detail: "Dynamic execution can turn untrusted input into executable code.",
          file: file.path,
          line: index + 1,
        });
      }
    });
  }
  const packageFile = (repo.indexedFiles || []).find((file) =>
    /(^|\/)package\.json$/.test(file.path),
  );
  if (packageFile?.content) {
    try {
      const packageData = JSON.parse(packageFile.content) as {
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
      };
      for (const key of Object.keys({
        ...packageData.dependencies,
        ...packageData.devDependencies,
      })) {
        dependencies.add(key);
      }
    } catch {}
  }
  for (const symbol of symbols.filter((item) => /^[A-Z][A-Za-z]+$/.test(item.name)).slice(0, 30)) {
    terms.push({
      term: symbol.name,
      detail: `${symbol.kind} defined in this repository`,
      evidence: `${symbol.file}:${symbol.line}`,
    });
  }
  return {
    edges,
    symbols,
    routes,
    dependencies: [...dependencies],
    terms,
    security,
  };
}
