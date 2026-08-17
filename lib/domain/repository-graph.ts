import type { SecurityFinding } from "./findings.ts";

export type Edge = {
  from: string;
  to: string;
  kind: "import" | "require";
};

export type SymbolInfo = {
  name: string;
  kind: string;
  file: string;
  line: number;
};

export type RouteInfo = {
  method: string;
  path: string;
  file: string;
};

export type TermInfo = {
  term: string;
  detail: string;
  evidence: string;
};

export type RepositoryGraph = {
  edges: Edge[];
  symbols: SymbolInfo[];
  routes: RouteInfo[];
  dependencies: string[];
  terms: TermInfo[];
  security: SecurityFinding[];
};
