import type { Recommendation, RiskFinding, SecurityFinding } from "./findings.ts";
import type { Edge, RouteInfo, SymbolInfo, TermInfo } from "./repository-graph.ts";

export type CountedName = {
  name: string;
  count: number;
};

export type Model = {
  topDirs: CountedName[];
  extensions: CountedName[];
  sourceFiles: string[];
  testFiles: string[];
  configFiles: string[];
  docs: string[];
  workflows: string[];
  security: SecurityFinding[];
  risks: RiskFinding[];
  recommendations: Recommendation[];
  edges?: Edge[];
  symbols?: SymbolInfo[];
  routes?: RouteInfo[];
  dependencies?: string[];
  terms?: TermInfo[];
};
