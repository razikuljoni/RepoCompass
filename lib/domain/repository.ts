export type IndexedFile = {
  path: string;
  size?: number;
  type?: string;
  content?: string;
};

export type RepositoryCommit = {
  sha: string;
  message: string;
  author: string;
  date: string;
};

export type RepositoryLanguage = {
  name: string;
  count: number;
};

export type Repo = {
  owner: string;
  name: string;
  provider: string;
  branch: string;
  branches?: string[];
  commits?: RepositoryCommit[];
  files: number;
  ignored: number;
  bytes: number;
  description?: string;
  stars?: number;
  languages: RepositoryLanguage[];
  sampleFiles: string[];
  indexedFiles?: IndexedFile[];
  source: "remote" | "local";
};

export type AnalyzeRepositoryResponse = Omit<Repo, "source"> & {
  key?: string;
  exclusions?: string[];
  analyzedAt?: string;
};
