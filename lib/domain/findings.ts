export type SecurityFinding = {
  level: string;
  title: string;
  detail: string;
  file?: string;
  line?: number;
};

export type RiskFinding = {
  title: string;
  detail: string;
  score: number;
  file?: string;
};

export type Recommendation = {
  priority: string;
  title: string;
  reason: string;
};
