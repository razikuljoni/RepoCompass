import { createHash } from "node:crypto";
import ts from "typescript";
import { canonicalizeCodeGraph } from "./canonicalize-code-graph.ts";
import {
  compareCodeUnits,
  resolveTypeScriptModule,
  type TypeScriptModuleResolutionConfig,
} from "./typescript-module-resolution.ts";
import {
  codeGraphLimits,
  type CodeGraphV2,
  type GraphDiagnostic,
  type GraphEdgeV2,
  type GraphEvidenceV2,
  type GraphNodeV2,
} from "../domain/code-graph.ts";
import { parseRepositorySnapshot, type RepositorySnapshot } from "../domain/repository-snapshot.ts";

export type TypeScriptSourceInput = { path: string; content: string };
export type TypeScriptCodeGraphExtractorInput = {
  snapshot: RepositorySnapshot;
  files: readonly TypeScriptSourceInput[];
};

type SymbolRecord = {
  id: string;
  path: string;
  name: string;
  node: ts.Node;
  parentId?: string;
  parentName?: string;
};
type Context = {
  nodes: GraphNodeV2[];
  edges: GraphEdgeV2[];
  diagnostics: GraphDiagnostic[];
  symbols: SymbolRecord[];
  symbolByNode: Map<ts.Node, SymbolRecord>;
  symbolById: Map<string, SymbolRecord>;
  fileIds: Map<string, string>;
  paths: Set<string>;
  moduleConfigs: TypeScriptModuleResolutionConfig[];
  truncated: boolean;
};

const supportedPattern = /(?:\.d\.ts|\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs))$/i;

function directory(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
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

function moduleConfigs(
  files: readonly TypeScriptSourceInput[],
): TypeScriptModuleResolutionConfig[] {
  const configs: TypeScriptModuleResolutionConfig[] = [];
  for (const file of files) {
    if (!/(?:^|\/)tsconfig\.json$/.test(file.path)) continue;
    const parsed = ts.parseConfigFileTextToJson(file.path, file.content);
    if (parsed.error || !parsed.config || typeof parsed.config !== "object") continue;
    const compilerOptions = (parsed.config as { compilerOptions?: unknown }).compilerOptions;
    if (!compilerOptions || typeof compilerOptions !== "object") continue;
    const options = compilerOptions as { baseUrl?: unknown; paths?: unknown };
    const configDirectory = directory(file.path);
    const configuredBase = typeof options.baseUrl === "string" ? options.baseUrl : ".";
    const baseUrl = normalize(`${configDirectory}/${configuredBase}`) ?? configDirectory;
    const paths: Record<string, readonly string[]> = {};
    if (options.paths && typeof options.paths === "object" && !Array.isArray(options.paths)) {
      for (const [pattern, targets] of Object.entries(options.paths)) {
        if (Array.isArray(targets) && targets.every((target) => typeof target === "string")) {
          paths[pattern] = targets;
        }
      }
    }
    configs.push({ path: file.path, baseUrl, paths });
  }
  return configs.sort((left, right) => compareCodeUnits(left.path, right.path));
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function identity(prefix: string, value: string): string {
  return `${prefix}:${hash(value)}`;
}

function scriptKind(path: string): ts.ScriptKind {
  if (/\.tsx$/i.test(path)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(path)) return ts.ScriptKind.JSX;
  if (/\.(?:js|mjs|cjs)$/i.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function language(path: string): string {
  if (/\.(?:js|jsx|mjs|cjs)$/i.test(path)) return "JavaScript";
  return "TypeScript";
}

function location(source: ts.SourceFile, node: ts.Node): GraphEvidenceV2 {
  const start = source.getLineAndCharacterOfPosition(node.getStart(source));
  const end = source.getLineAndCharacterOfPosition(node.getEnd());
  return {
    path: source.fileName,
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

function addNode(context: Context, node: GraphNodeV2): boolean {
  if (context.nodes.some((item) => item.id === node.id)) return true;
  if (context.nodes.length >= codeGraphLimits.maxNodes) {
    context.truncated = true;
    return false;
  }
  context.nodes.push(node);
  return true;
}

function addEdge(context: Context, edge: Omit<GraphEdgeV2, "id">): void {
  if (context.edges.length >= codeGraphLimits.maxEdges) {
    context.truncated = true;
    return;
  }
  const key = JSON.stringify({
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    provenance: edge.provenance,
    confidence: edge.confidence,
    metadata: edge.metadata,
  });
  context.edges.push({ ...edge, id: identity("edge", key) });
}

function modifiers(node: ts.Node): readonly ts.Modifier[] {
  return ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return modifiers(node).some((item) => item.kind === kind);
}

function hasAncestorModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  let current: ts.Node | undefined = node;
  while (current && !ts.isSourceFile(current)) {
    if (hasModifier(current, kind)) return true;
    current = current.parent;
  }
  return false;
}

function declarationName(node: ts.Declaration): string | undefined {
  if (ts.isConstructorDeclaration(node)) return "constructor";
  const named = node as ts.Declaration & { name?: ts.DeclarationName };
  if (!named.name) {
    return hasModifier(node, ts.SyntaxKind.DefaultKeyword) ? "default" : undefined;
  }
  if (
    ts.isIdentifier(named.name) ||
    ts.isStringLiteral(named.name) ||
    ts.isNumericLiteral(named.name)
  ) {
    return named.name.text;
  }
  return undefined;
}

function declarationKind(node: ts.Declaration): string | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))
    return "function";
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isEnumDeclaration(node)) return "enum";
  if (ts.isVariableDeclaration(node)) return "variable";
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) return "method";
  if (ts.isGetAccessorDeclaration(node)) return "getter";
  if (ts.isSetAccessorDeclaration(node)) return "setter";
  if (ts.isConstructorDeclaration(node)) return "constructor";
  return undefined;
}

function visibility(node: ts.Node): "public" | "protected" | "private" | "internal" {
  if (hasModifier(node, ts.SyntaxKind.PrivateKeyword)) return "private";
  if (hasModifier(node, ts.SyntaxKind.ProtectedKeyword)) return "protected";
  return "public";
}

function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return parts.slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
}

function nearestContainerId(
  node: ts.Node,
  records: ReadonlyMap<ts.Node, SymbolRecord>,
): string | undefined {
  let parent = node.parent;
  while (parent) {
    const match = records.get(parent);
    if (match) return match.id;
    parent = parent.parent;
  }
  return undefined;
}

function declareSymbols(source: ts.SourceFile, context: Context): void {
  const fileId = context.fileIds.get(source.fileName)!;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && !ts.isIdentifier(node.name)) {
      ts.forEachChild(node, visit);
      return;
    }
    const kind = declarationKind(node as ts.Declaration);
    let name = kind ? declarationName(node as ts.Declaration) : undefined;
    if (!name && (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node))) name = "default";
    if (kind && name) {
      const parentRecord = nearestContainerId(node, context.symbolByNode);
      const parent = parentRecord ? context.symbolById.get(parentRecord) : undefined;
      const qualified = parent ? `${parent.name}.${name}` : name;
      const at = location(source, node);
      const id = identity(
        "symbol",
        `${source.fileName}\0${kind}\0${qualified}\0${at.startLine}\0${at.startColumn}`,
      );
      const nodeLocation = at;
      const symbolNode: GraphNodeV2 = {
        id,
        kind: "symbol",
        name,
        location: nodeLocation,
        metadata: {
          symbolKind: kind,
          qualifiedName: `${source.fileName}:${qualified}`,
          visibility: visibility(node),
          exported:
            hasModifier(node, ts.SyntaxKind.ExportKeyword) ||
            hasModifier(node.parent, ts.SyntaxKind.ExportKeyword),
          async: hasModifier(node, ts.SyntaxKind.AsyncKeyword),
        },
      };
      if (addNode(context, symbolNode)) {
        const record: SymbolRecord = {
          id,
          path: source.fileName,
          name,
          node,
          ...(parentRecord ? { parentId: parentRecord, parentName: parent?.name } : {}),
        };
        context.symbols.push(record);
        context.symbolByNode.set(node, record);
        context.symbolById.set(id, record);
        addEdge(context, {
          from: parentRecord ?? fileId,
          to: id,
          kind: parentRecord ? "contains" : "declares",
          provenance: "EXTRACTED",
          confidence: 1,
          evidence: [at],
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function importTarget(
  source: ts.SourceFile,
  specifier: string,
  context: Context,
): { id: string; resolution: ReturnType<typeof resolveTypeScriptModule> } {
  const resolution = resolveTypeScriptModule(
    specifier,
    source.fileName,
    context.paths,
    context.moduleConfigs,
  );
  if (resolution.resolvedPath) {
    return { id: context.fileIds.get(resolution.resolvedPath)!, resolution };
  }
  const name = resolution.packageName ?? packageName(specifier);
  const placeholder = resolution.resolution === "unresolved" ? `unresolved:${specifier}` : name;
  const id = identity("package", placeholder);
  addNode(context, {
    id,
    kind: "package",
    name: placeholder,
    metadata: { packageName: placeholder },
  });
  return { id, resolution };
}

function addImport(
  source: ts.SourceFile,
  context: Context,
  node: ts.Node,
  specifier: string,
  mode: "static" | "dynamic" | "require" | "type",
  typeOnly: boolean,
): void {
  const target = importTarget(source, specifier, context);
  const ambiguous = target.resolution.resolution === "ambiguous";
  addEdge(context, {
    from: context.fileIds.get(source.fileName)!,
    to: target.id,
    kind: mode === "require" ? "requires" : "imports",
    provenance: ambiguous ? "AMBIGUOUS" : "EXTRACTED",
    confidence: ambiguous ? 0.5 : 1,
    evidence: [location(source, node)],
    metadata: {
      mode,
      specifier,
      typeOnly,
      resolution: target.resolution.resolution,
      candidates: target.resolution.candidates,
    },
  });
  if (target.resolution.resolution === "unresolved") {
    context.diagnostics.push({
      code: "MODULE_UNRESOLVED",
      severity: "warning",
      message: `Could not resolve module ${specifier}`,
      location: location(source, node),
    });
  }
}

function extractImports(source: ts.SourceFile, context: Context): void {
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const typeOnly = Boolean(node.importClause?.isTypeOnly);
      addImport(
        source,
        context,
        node,
        node.moduleSpecifier.text,
        typeOnly ? "type" : "static",
        typeOnly,
      );
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const typeOnly = node.isTypeOnly;
      addImport(
        source,
        context,
        node,
        node.moduleSpecifier.text,
        typeOnly ? "type" : "static",
        typeOnly,
      );
    } else if (ts.isCallExpression(node)) {
      const mode =
        node.expression.kind === ts.SyntaxKind.ImportKeyword
          ? "dynamic"
          : ts.isIdentifier(node.expression) && node.expression.text === "require"
            ? "require"
            : undefined;
      if (mode && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
        addImport(source, context, node, node.arguments[0].text, mode, false);
      } else if (mode) {
        context.diagnostics.push({
          code: "MODULE_SPECIFIER_UNSUPPORTED",
          severity: "warning",
          message: `Could not analyze non-literal ${mode} module specifier`,
          location: location(source, node),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function isTestCallback(node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current?.parent) {
    const parent: ts.Node = current.parent;
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isCallExpression(parent) &&
      parent.arguments[1] === current &&
      ts.isIdentifier(parent.expression) &&
      /^(?:it|test)$/.test(parent.expression.text)
    ) {
      return true;
    }
    current = parent;
  }
  return false;
}

function extractRelationships(source: ts.SourceFile, context: Context): void {
  const local = context.symbols.filter((item) => item.path === source.fileName);
  const imported = new Map<string, SymbolRecord>();
  const namespaces = new Map<string, SymbolRecord[]>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const resolved = resolveTypeScriptModule(
      statement.moduleSpecifier.text,
      source.fileName,
      context.paths,
      context.moduleConfigs,
    );
    if (!resolved.resolvedPath) continue;
    const targets = context.symbols.filter((item) => item.path === resolved.resolvedPath);
    const clause = statement.importClause;
    if (clause?.name) {
      const target = targets.find((item) => item.name === "default");
      if (target) imported.set(clause.name.text, target);
    }
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        const target = targets.find(
          (item) => item.name === (element.propertyName ?? element.name).text,
        );
        if (target) imported.set(element.name.text, target);
      }
    } else if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      namespaces.set(clause.namedBindings.name.text, targets);
    }
  }
  const instances = new Map<string, string>();
  for (const item of local) {
    if (
      ts.isVariableDeclaration(item.node) &&
      item.node.initializer &&
      ts.isNewExpression(item.node.initializer) &&
      ts.isIdentifier(item.node.initializer.expression)
    ) {
      instances.set(item.name, item.node.initializer.expression.text);
    }
  }
  const resolveSymbol = (name: string): SymbolRecord | undefined =>
    local.find((item) => item.name === name && !item.parentId) ?? imported.get(name);
  const propertyTarget = (expression: ts.PropertyAccessExpression): SymbolRecord | undefined => {
    if (ts.isIdentifier(expression.expression)) {
      const namespace = namespaces.get(expression.expression.text);
      if (namespace)
        return namespace.find((item) => item.name === expression.name.text && !item.parentId);
      const classRecord = resolveSymbol(instances.get(expression.expression.text) ?? "");
      if (classRecord) {
        return context.symbols.find(
          (item) => item.parentId === classRecord.id && item.name === expression.name.text,
        );
      }
    }
    if (expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
      const ownerId = nearestContainerId(expression, context.symbolByNode);
      const owner = ownerId ? context.symbolById.get(ownerId) : undefined;
      return local.find(
        (item) =>
          item.parentId === (owner?.parentId ?? owner?.id) && item.name === expression.name.text,
      );
    }
    return undefined;
  };
  const visit = (node: ts.Node): void => {
    const owner =
      nearestContainerId(node, context.symbolByNode) ?? context.fileIds.get(source.fileName)!;
    if (ts.isCallExpression(node)) {
      const target = ts.isIdentifier(node.expression)
        ? resolveSymbol(node.expression.text)
        : ts.isPropertyAccessExpression(node.expression)
          ? propertyTarget(node.expression)
          : undefined;
      if (target && target.id !== owner) {
        addEdge(context, {
          from: owner,
          to: target.id,
          kind: isTestCallback(node) ? "tests" : "calls",
          provenance: "EXTRACTED",
          confidence: 1,
          evidence: [location(source, node.expression)],
        });
      }
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      const target = resolveSymbol(node.expression.text);
      if (target && target.id !== owner) {
        addEdge(context, {
          from: owner,
          to: target.id,
          kind: isTestCallback(node) ? "tests" : "calls",
          provenance: "EXTRACTED",
          confidence: 1,
          evidence: [location(source, node.expression)],
        });
      }
    }
    if ((ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.heritageClauses) {
      const record = context.symbolByNode.get(node);
      if (record) {
        for (const clause of node.heritageClauses) {
          for (const type of clause.types) {
            if (!ts.isIdentifier(type.expression)) continue;
            const target = resolveSymbol(type.expression.text);
            if (!target) continue;
            addEdge(context, {
              from: record.id,
              to: target.id,
              kind: clause.token === ts.SyntaxKind.ImplementsKeyword ? "implements" : "extends",
              provenance: "EXTRACTED",
              confidence: 1,
              evidence: [location(source, type)],
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function addRoute(
  source: ts.SourceFile,
  context: Context,
  path: string,
  method: string,
  framework: string,
  node: ts.Node,
  handlerId?: string,
): void {
  const normalizedMethod = method.toUpperCase();
  const id = identity("route", `${framework}\0${normalizedMethod}\0${path}\0${source.fileName}`);
  const routeEvidence = location(source, node);
  const routeLocation = routeEvidence;
  if (
    addNode(context, {
      id,
      kind: "route",
      name: `${normalizedMethod} ${path}`,
      location: routeLocation,
      metadata: { path, methods: [normalizedMethod], framework },
    })
  ) {
    addEdge(context, {
      from: handlerId ?? context.fileIds.get(source.fileName)!,
      to: id,
      kind: "handles-route",
      provenance: "EXTRACTED",
      confidence: 1,
      evidence: [routeEvidence],
    });
  }
}

function nextRoute(path: string): { route: string; api: boolean; page: boolean } | undefined {
  const app = path.match(/(?:^|\/)app(?:\/(.*))?\/(route|page)\.(?:[cm]?[jt]sx?)$/i);
  if (app) {
    const segments = (app[1] ?? "")
      .split("/")
      .filter((item) => item && !/^\(.+\)$/.test(item) && !/^@.+/.test(item));
    return {
      route: `/${segments.join("/")}`.replace(/\/index$/, "") || "/",
      api: app[2] === "route",
      page: app[2] === "page",
    };
  }
  const rootApp = path.match(/(?:^|\/)app\/(route|page)\.(?:[cm]?[jt]sx?)$/i);
  if (rootApp) return { route: "/", api: rootApp[1] === "route", page: rootApp[1] === "page" };
  const pages = path.match(/(?:^|\/)pages\/api\/(.+)\.(?:[cm]?[jt]sx?)$/i);
  if (pages) return { route: `/api/${pages[1]}`.replace(/\/index$/, ""), api: true, page: false };
  return undefined;
}

function routeHandler(
  source: ts.SourceFile,
  context: Context,
  call: ts.CallExpression,
): string | undefined {
  const callback = call.arguments.at(-1);
  if (!callback || callback === call.arguments[0]) return undefined;
  if (ts.isIdentifier(callback)) {
    const local = context.symbols.find(
      (item) => item.path === source.fileName && !item.parentId && item.name === callback.text,
    );
    if (local) return local.id;
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
        continue;
      const element =
        statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings)
          ? statement.importClause.namedBindings.elements.find(
              (item) => item.name.text === callback.text,
            )
          : undefined;
      if (!element) continue;
      const resolution = resolveTypeScriptModule(
        statement.moduleSpecifier.text,
        source.fileName,
        context.paths,
        context.moduleConfigs,
      );
      const importedName = (element.propertyName ?? element.name).text;
      return context.symbols.find(
        (item) =>
          item.path === resolution.resolvedPath && !item.parentId && item.name === importedName,
      )?.id;
    }
    return undefined;
  }
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return undefined;
  const at = location(source, callback);
  const name = `<route-handler:${at.startLine}:${at.startColumn}>`;
  const id = identity(
    "symbol",
    `${source.fileName}\0function\0${name}\0${at.startLine}\0${at.startColumn}`,
  );
  if (
    addNode(context, {
      id,
      kind: "symbol",
      name,
      location: at,
      metadata: {
        symbolKind: "function",
        qualifiedName: `${source.fileName}:${name}`,
        visibility: "internal",
        exported: false,
        async: hasModifier(callback, ts.SyntaxKind.AsyncKeyword),
      },
    })
  ) {
    addEdge(context, {
      from: context.fileIds.get(source.fileName)!,
      to: id,
      kind: "declares",
      provenance: "EXTRACTED",
      confidence: 1,
      evidence: [at],
    });
  }
  return id;
}

function extractRoutes(source: ts.SourceFile, context: Context): void {
  const convention = nextRoute(source.fileName);
  if (convention) {
    const methods = context.symbols.filter(
      (item) =>
        item.path === source.fileName &&
        !item.parentId &&
        /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(item.name) &&
        hasAncestorModifier(item.node, ts.SyntaxKind.ExportKeyword),
    );
    if (methods.length) {
      for (const item of methods)
        addRoute(source, context, convention.route, item.name, "Next.js", item.node, item.id);
    } else if (convention.page || !convention.api) {
      const handler = context.symbols.find(
        (item) => item.path === source.fileName && !item.parentId && item.name === "default",
      );
      addRoute(
        source,
        context,
        convention.route,
        "GET",
        "Next.js",
        handler?.node ?? source,
        handler?.id,
      );
    } else if (/\/(?:pages\/api)\//.test(`/${source.fileName}`)) {
      const handler = context.symbols.find(
        (item) => item.path === source.fileName && !item.parentId && item.name === "default",
      );
      addRoute(
        source,
        context,
        convention.route,
        "ALL",
        "Next.js",
        handler?.node ?? source,
        handler?.id,
      );
    }
  }
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      /^(?:app|router)$/.test(node.expression.expression.text) &&
      /^(?:get|post|put|patch|delete|head|options|all)$/.test(node.expression.name.text) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      addRoute(
        source,
        context,
        node.arguments[0].text,
        node.expression.name.text === "all" ? "ALL" : node.expression.name.text,
        "Express",
        node,
        routeHandler(source, context, node),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function build(input: TypeScriptCodeGraphExtractorInput): CodeGraphV2 {
  const snapshot = parseRepositorySnapshot(input.snapshot);
  const manifest = new Map(snapshot.manifest.map((item) => [item.path, item]));
  const allFiles = [...input.files]
    .filter((item) => manifest.has(item.path))
    .sort((left, right) => compareCodeUnits(left.path, right.path));
  const files = allFiles.filter((item) => supportedPattern.test(item.path));
  const uniqueFiles = [...new Map(files.map((item) => [item.path, item])).values()];
  const context: Context = {
    nodes: [],
    edges: [],
    diagnostics: [],
    symbols: [],
    symbolByNode: new Map(),
    symbolById: new Map(),
    fileIds: new Map(),
    paths: new Set(uniqueFiles.map((item) => item.path)),
    moduleConfigs: moduleConfigs(allFiles),
    truncated: false,
  };
  for (const item of allFiles) {
    if (!supportedPattern.test(item.path) && !/(?:^|\/)tsconfig\.json$/.test(item.path)) {
      context.diagnostics.push({
        code: "SOURCE_FILE_UNSUPPORTED",
        severity: "warning",
        message: `No TypeScript extractor support for analyzed source file ${item.path}`,
        location: { path: item.path },
      });
    }
  }
  const sources = uniqueFiles.map((item) =>
    ts.createSourceFile(
      item.path,
      item.content,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(item.path),
    ),
  );
  const syntacticDiagnostics = new Map<string, readonly ts.Diagnostic[]>();
  const host: ts.CompilerHost = {
    fileExists: (path) => context.paths.has(path),
    readFile: (path) => uniqueFiles.find((item) => item.path === path)?.content,
    getSourceFile: (path) => sources.find((item) => item.fileName === path),
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => undefined,
    getCurrentDirectory: () => "",
    getDirectories: () => [],
    getCanonicalFileName: (path) => path,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const program = ts.createProgram(
    sources.map((item) => item.fileName),
    { noLib: true, noResolve: true, allowJs: true, jsx: ts.JsxEmit.Preserve },
    host,
  );
  for (const source of sources) {
    syntacticDiagnostics.set(source.fileName, program.getSyntacticDiagnostics(source));
  }
  for (const [index, source] of sources.entries()) {
    const item = uniqueFiles[index];
    const entry = manifest.get(item.path)!;
    const id = identity("file", item.path);
    context.fileIds.set(item.path, id);
    addNode(context, {
      id,
      kind: "file",
      name: item.path.slice(item.path.lastIndexOf("/") + 1),
      location: { path: item.path },
      metadata: {
        path: item.path,
        language: language(item.path),
        sizeBytes: entry.size,
        ...(entry.contentSha256 ? { contentSha256: entry.contentSha256 } : {}),
      },
    });
    for (const diagnostic of syntacticDiagnostics.get(source.fileName) ?? []) {
      const start = diagnostic.start ?? 0;
      const point = source.getLineAndCharacterOfPosition(start);
      context.diagnostics.push({
        code: `TS${diagnostic.code}`,
        severity: "warning",
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
        location: { path: item.path, startLine: point.line + 1, startColumn: point.character + 1 },
      });
    }
  }
  for (const source of sources) declareSymbols(source, context);
  for (const source of sources) {
    extractImports(source, context);
    extractRelationships(source, context);
    extractRoutes(source, context);
  }
  if (context.truncated) {
    context.diagnostics.push({
      code: "GRAPH_TRUNCATED",
      severity: "warning",
      message: "Graph extraction reached a CodeGraph limit",
    });
  }
  const diagnostics = context.diagnostics.slice(0, codeGraphLimits.maxDiagnostics);
  const graph: CodeGraphV2 = {
    schemaVersion: "2.0",
    snapshot,
    limits: codeGraphLimits,
    coverage: {
      analyzedFiles: snapshot.coverage.analyzedFiles,
      totalFiles: snapshot.coverage.discoveredFiles,
      percentage:
        snapshot.coverage.discoveredFiles === 0
          ? 1
          : snapshot.coverage.analyzedFiles / snapshot.coverage.discoveredFiles,
      truncated: snapshot.coverage.truncated || context.truncated,
    },
    metrics: {
      nodeCount: context.nodes.length,
      edgeCount: context.edges.length,
      diagnosticCount: diagnostics.length,
    },
    diagnostics,
    nodes: context.nodes,
    edges: context.edges,
  };
  return canonicalizeCodeGraph(graph) as CodeGraphV2;
}

export function extractTypeScriptCodeGraph(input: TypeScriptCodeGraphExtractorInput): CodeGraphV2;
export function extractTypeScriptCodeGraph(
  snapshot: RepositorySnapshot,
  files: readonly TypeScriptSourceInput[],
): CodeGraphV2;
export function extractTypeScriptCodeGraph(
  input: TypeScriptCodeGraphExtractorInput | RepositorySnapshot,
  files?: readonly TypeScriptSourceInput[],
): CodeGraphV2 {
  return build("snapshot" in input ? input : { snapshot: input, files: files ?? [] });
}
