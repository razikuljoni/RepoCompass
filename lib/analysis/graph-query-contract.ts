import {
  graphEdgeKinds,
  graphEdgeKindsV2,
  graphNodeKinds,
  graphNodeKindsV2,
  type GraphEdgeKind,
  type GraphEdgeKindV2,
  type GraphNodeKind,
  type GraphNodeKindV2,
} from "../domain/code-graph.ts";

export const graphQuerySchemaVersion = "1.0" as const;

export const graphQueryLimits = {
  defaultMaxCost: 10_000,
  maximumMaxCost: 50_000,
  defaultMaxResults: 50,
  maximumMaxResults: 500,
  defaultMaxDepth: 8,
  maximumMaxDepth: 20,
  defaultMaxTimeMs: 100,
  maximumMaxTimeMs: 2_000,
  maximumSearchLength: 256,
} as const;

export type GraphQueryBudget = {
  maxCost: number;
  maxResults: number;
  maxTimeMs: number;
};

export type GraphQueryDirection = "incoming" | "outgoing" | "both";
export type QueryNodeKind = GraphNodeKind | GraphNodeKindV2;
export type QueryEdgeKind = GraphEdgeKind | GraphEdgeKindV2;

type GraphQueryBase = {
  budget: GraphQueryBudget;
};

export type GraphQuery =
  | (GraphQueryBase & {
      type: "search";
      text: string;
      kinds?: QueryNodeKind[];
      cursor: number;
    })
  | (GraphQueryBase & { type: "node"; nodeId: string })
  | (GraphQueryBase & {
      type: "neighbors";
      nodeId: string;
      direction: GraphQueryDirection;
      edgeKinds?: QueryEdgeKind[];
      cursor: number;
    })
  | (GraphQueryBase & {
      type: "shortestPath";
      from: string;
      to: string;
      direction: GraphQueryDirection;
      edgeKinds?: QueryEdgeKind[];
      maxDepth: number;
    })
  | (GraphQueryBase & {
      type: "impact";
      nodeId: string;
      direction: GraphQueryDirection;
      edgeKinds?: QueryEdgeKind[];
      maxDepth: number;
    })
  | (GraphQueryBase & { type: "explain"; nodeId: string });

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  input: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(input).find((key) => !allowed.has(key));
  if (unknown) throw new TypeError(`${path}.${unknown} is not allowed`);
  const missing = required.find((key) => !Object.hasOwn(input, key));
  if (missing) throw new TypeError(`${path}.${missing} is required`);
}

function strictString(value: unknown, path: string, maximum = 1024): string {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(
      `${path} must be a non-empty bounded string without whitespace or control characters`,
    );
  }
  return value;
}

function boundedInteger(
  value: unknown,
  path: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new TypeError(`${path} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
}

function positiveInteger(value: unknown, path: string, fallback: number, maximum: number): number {
  return boundedInteger(value, path, fallback, 1, maximum);
}

function budget(value: unknown): GraphQueryBudget {
  if (value === undefined) {
    return {
      maxCost: graphQueryLimits.defaultMaxCost,
      maxResults: graphQueryLimits.defaultMaxResults,
      maxTimeMs: graphQueryLimits.defaultMaxTimeMs,
    };
  }
  const input = record(value, "query.budget");
  exactKeys(input, [], ["maxCost", "maxResults", "maxTimeMs"], "query.budget");
  return {
    maxCost: positiveInteger(
      input.maxCost,
      "query.budget.maxCost",
      graphQueryLimits.defaultMaxCost,
      graphQueryLimits.maximumMaxCost,
    ),
    maxResults: positiveInteger(
      input.maxResults,
      "query.budget.maxResults",
      graphQueryLimits.defaultMaxResults,
      graphQueryLimits.maximumMaxResults,
    ),
    maxTimeMs: positiveInteger(
      input.maxTimeMs,
      "query.budget.maxTimeMs",
      graphQueryLimits.defaultMaxTimeMs,
      graphQueryLimits.maximumMaxTimeMs,
    ),
  };
}

function direction(value: unknown): GraphQueryDirection {
  if (value === undefined) return "both";
  if (value !== "incoming" && value !== "outgoing" && value !== "both") {
    throw new TypeError("query.direction is not supported");
  }
  return value;
}

function enumArray<T extends string>(
  value: unknown,
  path: string,
  supported: readonly T[],
): T[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0)
    throw new TypeError(`${path} must be a non-empty array`);
  const allowed = new Set<string>(supported);
  const result = value.map((item, index) => {
    if (typeof item !== "string" || !allowed.has(item)) {
      throw new TypeError(`${path}[${index}] is not supported`);
    }
    return item as T;
  });
  return [...new Set(result)].sort();
}

export function parseGraphQuery(value: unknown): GraphQuery {
  const input = record(value, "query");
  const type = input.type;
  const parsedBudget = budget(input.budget);
  const nodeKinds = [...new Set([...graphNodeKinds, ...graphNodeKindsV2])];
  const edgeKinds = [...new Set([...graphEdgeKinds, ...graphEdgeKindsV2])];
  if (type === "search") {
    exactKeys(input, ["type", "text"], ["kinds", "cursor", "budget"], "query");
    return {
      type,
      text: strictString(input.text, "query.text", graphQueryLimits.maximumSearchLength),
      ...(input.kinds === undefined
        ? {}
        : { kinds: enumArray(input.kinds, "query.kinds", nodeKinds)! }),
      cursor: boundedInteger(input.cursor, "query.cursor", 0, 0, graphQueryLimits.maximumMaxCost),
      budget: parsedBudget,
    };
  }
  if (type === "node" || type === "explain") {
    exactKeys(input, ["type", "nodeId"], ["budget"], "query");
    return { type, nodeId: strictString(input.nodeId, "query.nodeId"), budget: parsedBudget };
  }
  if (type === "neighbors") {
    exactKeys(input, ["type", "nodeId"], ["direction", "edgeKinds", "cursor", "budget"], "query");
    return {
      type,
      nodeId: strictString(input.nodeId, "query.nodeId"),
      direction: direction(input.direction),
      ...(input.edgeKinds === undefined
        ? {}
        : { edgeKinds: enumArray(input.edgeKinds, "query.edgeKinds", edgeKinds)! }),
      cursor: boundedInteger(input.cursor, "query.cursor", 0, 0, graphQueryLimits.maximumMaxCost),
      budget: parsedBudget,
    };
  }
  if (type === "impact") {
    exactKeys(input, ["type", "nodeId"], ["direction", "edgeKinds", "maxDepth", "budget"], "query");
    return {
      type,
      nodeId: strictString(input.nodeId, "query.nodeId"),
      direction: direction(input.direction),
      ...(input.edgeKinds === undefined
        ? {}
        : { edgeKinds: enumArray(input.edgeKinds, "query.edgeKinds", edgeKinds)! }),
      maxDepth: positiveInteger(
        input.maxDepth,
        "query.maxDepth",
        graphQueryLimits.defaultMaxDepth,
        graphQueryLimits.maximumMaxDepth,
      ),
      budget: parsedBudget,
    };
  }
  if (type === "shortestPath") {
    exactKeys(
      input,
      ["type", "from", "to"],
      ["direction", "edgeKinds", "maxDepth", "budget"],
      "query",
    );
    return {
      type,
      from: strictString(input.from, "query.from"),
      to: strictString(input.to, "query.to"),
      direction: direction(input.direction),
      ...(input.edgeKinds === undefined
        ? {}
        : { edgeKinds: enumArray(input.edgeKinds, "query.edgeKinds", edgeKinds)! }),
      maxDepth: positiveInteger(
        input.maxDepth,
        "query.maxDepth",
        graphQueryLimits.defaultMaxDepth,
        graphQueryLimits.maximumMaxDepth,
      ),
      budget: parsedBudget,
    };
  }
  throw new TypeError("query.type is not supported");
}
