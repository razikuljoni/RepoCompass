export type TypeScriptModuleResolution = {
  resolution: "resolved" | "external" | "unresolved" | "ambiguous";
  candidates: string[];
  resolvedPath?: string;
  packageName?: string;
};

export type TypeScriptModuleResolutionConfig = {
  path: string;
  baseUrl: string;
  paths: Readonly<Record<string, readonly string[]>>;
};

export type TypeScriptWorkspacePackage = {
  name: string;
  root: string;
  entries: Readonly<Record<string, readonly string[]>>;
};

const extensions = [".ts", ".tsx", ".mts", ".cts", ".d.ts", ".js", ".jsx", ".mjs", ".cjs"] as const;
const javascriptExtensions = [".js", ".jsx", ".mjs", ".cjs"] as const;

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalize(path: string): string | undefined {
  const output: string[] = [];
  for (const segment of path.replaceAll("\\", "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!output.length) return undefined;
      output.pop();
    } else output.push(segment);
  }
  return output.join("/");
}

function directory(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return parts.slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
}

function isWithin(path: string, parent: string): boolean {
  return !parent || path === parent || path.startsWith(`${parent}/`);
}

function probe(base: string, paths: ReadonlySet<string>): string[] {
  const attempted: string[] = [base];
  const extension = extensions.find((item) => base.endsWith(item));
  if (
    extension &&
    javascriptExtensions.includes(extension as (typeof javascriptExtensions)[number])
  ) {
    const stem = base.slice(0, -extension.length);
    attempted.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`, `${stem}.d.ts`);
  }
  if (!extension) {
    attempted.push(...extensions.map((item) => `${base}${item}`));
    attempted.push(...extensions.map((item) => `${base}/index${item}`));
  }
  return attempted.filter((item) => paths.has(item));
}

function patternMatch(pattern: string, specifier: string): string | undefined {
  const star = pattern.indexOf("*");
  if (star < 0) return pattern === specifier ? "" : undefined;
  if (pattern.indexOf("*", star + 1) >= 0) return undefined;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return undefined;
  return specifier.slice(prefix.length, specifier.length - suffix.length || undefined);
}

function matchingPatterns(
  paths: Readonly<Record<string, readonly string[]>>,
  specifier: string,
): string[] {
  return Object.keys(paths)
    .filter((pattern) => patternMatch(pattern, specifier) !== undefined)
    .sort((left, right) => {
      const leftLiteral = left.replace("*", "").length;
      const rightLiteral = right.replace("*", "").length;
      return rightLiteral - leftLiteral || compareCodeUnits(left, right);
    });
}

function nearestConfig(
  importerPath: string,
  configs: readonly TypeScriptModuleResolutionConfig[],
): TypeScriptModuleResolutionConfig | undefined {
  const importerDirectory = directory(importerPath);
  return configs
    .filter((config) => isWithin(importerDirectory, directory(config.path)))
    .sort((left, right) => {
      const depth =
        directory(right.path).split("/").length - directory(left.path).split("/").length;
      return depth || compareCodeUnits(left.path, right.path);
    })[0];
}

function resolveBases(
  bases: readonly string[],
  paths: ReadonlySet<string>,
): TypeScriptModuleResolution {
  const candidates = [
    ...new Set(
      bases.flatMap((base) => {
        const normalized = normalize(base);
        return normalized ? probe(normalized, paths) : [];
      }),
    ),
  ].sort(compareCodeUnits);
  if (candidates.length > 1) return { resolution: "ambiguous", candidates };
  const resolvedPath = candidates[0];
  return resolvedPath
    ? { resolution: "resolved", candidates, resolvedPath }
    : { resolution: "unresolved", candidates };
}

function workspaceSpecifier(
  specifier: string,
  workspacePackages: readonly TypeScriptWorkspacePackage[],
): { packages: TypeScriptWorkspacePackage[]; subpath: string } | undefined {
  const name = packageName(specifier);
  const packages = workspacePackages.filter((item) => item.name === name);
  if (!packages.length) return undefined;
  const remainder = specifier.slice(name.length);
  return { packages, subpath: remainder ? `.${remainder}` : "." };
}

export function resolveTypeScriptModule(
  specifier: string,
  importerPath: string,
  repositoryPaths: ReadonlySet<string> | readonly string[],
  configs: readonly TypeScriptModuleResolutionConfig[] = [],
  workspacePackages: readonly TypeScriptWorkspacePackage[] = [],
): TypeScriptModuleResolution {
  const paths = repositoryPaths instanceof Set ? repositoryPaths : new Set(repositoryPaths);
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const base = specifier.startsWith("/")
      ? specifier.slice(1)
      : `${directory(importerPath)}/${specifier}`;
    return resolveBases([base], paths);
  }
  const workspace = workspaceSpecifier(specifier, workspacePackages);
  if (workspace) {
    const bases = workspace.packages.flatMap((item) =>
      (item.entries[workspace.subpath] ?? []).map((entry) => `${item.root}/${entry}`),
    );
    const resolution = resolveBases(bases, paths);
    if (resolution.resolution !== "unresolved") return resolution;
    return { ...resolution, packageName: packageName(specifier) };
  }
  const config = nearestConfig(importerPath, configs);
  if (config) {
    const patterns = matchingPatterns(config.paths, specifier);
    if (patterns.length) {
      const pattern = patterns[0];
      const capture = patternMatch(pattern, specifier) ?? "";
      const targets = config.paths[pattern] ?? [];
      return resolveBases(
        targets.map((target) => `${config.baseUrl}/${target.replace("*", capture)}`),
        paths,
      );
    }
    if (config.baseUrl) {
      const baseUrlResolution = resolveBases([`${config.baseUrl}/${specifier}`], paths);
      if (baseUrlResolution.resolvedPath) return baseUrlResolution;
    }
  }
  return { resolution: "external", candidates: [], packageName: packageName(specifier) };
}
