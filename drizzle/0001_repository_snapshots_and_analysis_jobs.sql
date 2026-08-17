PRAGMA foreign_keys = ON;

CREATE TABLE repositories (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL DEFAULT 'github' CHECK (provider = 'github'),
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  provider_repository_id TEXT,
  default_branch TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT repositories_provider_owner_name_unique UNIQUE (provider, owner, name),
  CONSTRAINT repositories_canonical_url_unique UNIQUE (canonical_url),
  CONSTRAINT repositories_provider_repository_id_unique UNIQUE (provider, provider_repository_id)
);

CREATE TABLE repository_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  requested_ref TEXT NOT NULL,
  commit_sha TEXT NOT NULL CHECK (length(commit_sha) = 40),
  tree_sha TEXT NOT NULL CHECK (length(tree_sha) = 40),
  manifest_key TEXT,
  manifest_hash TEXT CHECK (manifest_hash IS NULL OR length(manifest_hash) = 64),
  file_count INTEGER NOT NULL DEFAULT 0 CHECK (file_count >= 0),
  total_bytes INTEGER NOT NULL DEFAULT 0 CHECK (total_bytes >= 0),
  created_at TEXT NOT NULL,
  CONSTRAINT repository_snapshots_repository_commit_unique UNIQUE (repository_id, commit_sha),
  CONSTRAINT repository_snapshots_manifest_pair CHECK ((manifest_key IS NULL) = (manifest_hash IS NULL))
);

CREATE TABLE analysis_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  snapshot_id TEXT NOT NULL REFERENCES repository_snapshots(id) ON DELETE CASCADE,
  analyzer_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  stage TEXT NOT NULL DEFAULT 'inventory' CHECK (stage IN ('inventory', 'fetch-content', 'analyze', 'complete')),
  cursor TEXT,
  completed_units INTEGER NOT NULL DEFAULT 0 CHECK (completed_units >= 0),
  total_units INTEGER NOT NULL DEFAULT 0 CHECK (total_units >= 0 AND completed_units <= total_units),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  result_key TEXT,
  result_hash TEXT CHECK (result_hash IS NULL OR length(result_hash) = 64),
  error_code TEXT,
  error_message TEXT,
  error_retryable INTEGER CHECK (error_retryable IS NULL OR error_retryable IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  CONSTRAINT analysis_jobs_result_pair CHECK ((result_key IS NULL) = (result_hash IS NULL)),
  CONSTRAINT analysis_jobs_error_fields CHECK (
    (error_code IS NULL AND error_message IS NULL AND error_retryable IS NULL) OR
    (error_code IS NOT NULL AND error_message IS NOT NULL AND error_retryable IS NOT NULL)
  ),
  CONSTRAINT analysis_jobs_succeeded_complete CHECK (status != 'succeeded' OR stage = 'complete')
);

CREATE TABLE anonymous_usage (
  id TEXT PRIMARY KEY NOT NULL,
  fingerprint_hash TEXT NOT NULL,
  window_start TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT anonymous_usage_fingerprint_window_unique UNIQUE (fingerprint_hash, window_start)
);

CREATE INDEX repositories_owner_name_idx ON repositories(owner, name);
CREATE INDEX repository_snapshots_repository_created_idx ON repository_snapshots(repository_id, created_at DESC);
CREATE INDEX analysis_jobs_snapshot_created_idx ON analysis_jobs(snapshot_id, created_at DESC);
CREATE INDEX analysis_jobs_status_stage_updated_idx ON analysis_jobs(status, stage, updated_at);
CREATE INDEX anonymous_usage_window_start_idx ON anonymous_usage(window_start);
