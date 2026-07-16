CREATE EXTENSION IF NOT EXISTS pgcrypto;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE ci_doctor FROM PUBLIC;

CREATE TYPE incident_state AS ENUM (
  'RECEIVED',
  'INGESTING',
  'CLUSTERING_FAILURES',
  'REPRODUCING',
  'DIAGNOSING',
  'PATCHING',
  'VALIDATING',
  'POLICY_GATE',
  'PR_OPENED',
  'CI_VERIFYING',
  'RESOLVED',
  'NEEDS_REVIEW',
  'FLAKY_UNCONFIRMED',
  'BUDGET_EXHAUSTED',
  'UNSAFE_REPOSITORY',
  'QUARANTINED',
  'VALIDATION_FAILED'
);

CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id text NOT NULL UNIQUE CHECK (length(delivery_id) BETWEEN 16 AND 200),
  event_name text NOT NULL CHECK (length(event_name) BETWEEN 1 AND 64),
  payload_sha256 char(64) NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  github_repo_id bigint NOT NULL,
  github_installation_id bigint NOT NULL,
  repo_full_name text NOT NULL,
  workflow_run_id bigint NOT NULL,
  run_attempt integer NOT NULL CHECK (run_attempt > 0),
  workflow_name text NOT NULL,
  head_sha char(40) NOT NULL CHECK (head_sha ~ '^[0-9a-f]{40}$'),
  base_sha char(40),
  state incident_state NOT NULL DEFAULT 'RECEIVED',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (github_repo_id, workflow_run_id, run_attempt)
);

CREATE INDEX incidents_active_idx ON incidents (state, created_at)
  WHERE state NOT IN ('RESOLVED', 'NEEDS_REVIEW', 'FLAKY_UNCONFIRMED', 'BUDGET_EXHAUSTED', 'UNSAFE_REPOSITORY', 'QUARANTINED', 'VALIDATION_FAILED');

CREATE TABLE incident_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 100),
  correlation_id uuid NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX incident_events_incident_sequence_idx ON incident_events (incident_id, sequence);

CREATE TABLE artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('workflow_jobs', 'job_log', 'trigger_diff')),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  content_type text NOT NULL CHECK (length(content_type) BETWEEN 3 AND 100),
  byte_length integer NOT NULL CHECK (byte_length >= 0 AND byte_length <= 5242880),
  encryption_algorithm text NOT NULL CHECK (encryption_algorithm = 'aes-256-gcm'),
  encryption_iv bytea NOT NULL CHECK (octet_length(encryption_iv) = 12),
  encryption_tag bytea NOT NULL CHECK (octet_length(encryption_tag) = 16),
  ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (incident_id, kind, sha256)
);

CREATE INDEX artifacts_incident_kind_idx ON artifacts (incident_id, kind, created_at);

CREATE TYPE failure_cluster_state AS ENUM ('PENDING', 'DIAGNOSED', 'NEEDS_REVIEW');

CREATE TABLE failure_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE RESTRICT,
  fingerprint char(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  test_name text NOT NULL CHECK (length(test_name) BETWEEN 1 AND 500),
  log_artifact_sha256 char(64) NOT NULL CHECK (log_artifact_sha256 ~ '^[0-9a-f]{64}$'),
  error_excerpt text NOT NULL CHECK (length(error_excerpt) BETWEEN 1 AND 4000),
  state failure_cluster_state NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (incident_id, fingerprint)
);

CREATE INDEX failure_clusters_pending_idx ON failure_clusters (incident_id, state)
  WHERE state = 'PENDING';

CREATE TABLE diagnosis_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id uuid NOT NULL REFERENCES failure_clusters(id) ON DELETE RESTRICT,
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 100),
  response_id text NOT NULL CHECK (length(response_id) BETWEEN 1 AND 200),
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  visible_summary text NOT NULL CHECK (length(visible_summary) BETWEEN 1 AND 2000),
  hypotheses jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cluster_id, attempt)
);

CREATE TABLE outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL CHECK (length(topic) BETWEEN 1 AND 100),
  dedupe_key text NOT NULL UNIQUE CHECK (length(dedupe_key) BETWEEN 1 AND 200),
  payload jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  leased_until timestamptz,
  lease_token uuid,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((completed_at IS NULL) OR (leased_until IS NULL))
);

CREATE INDEX outbox_dispatch_idx ON outbox (available_at, created_at)
  WHERE completed_at IS NULL;

GRANT CONNECT ON DATABASE ci_doctor TO ci_doctor_app;
GRANT USAGE ON SCHEMA public TO ci_doctor_app;
GRANT SELECT, INSERT ON webhook_deliveries TO ci_doctor_app;
GRANT SELECT, INSERT, UPDATE ON incidents TO ci_doctor_app;
GRANT SELECT, INSERT ON incident_events TO ci_doctor_app;
GRANT SELECT, INSERT ON artifacts TO ci_doctor_app;
GRANT SELECT, INSERT, UPDATE ON failure_clusters TO ci_doctor_app;
GRANT SELECT, INSERT ON diagnosis_findings TO ci_doctor_app;
GRANT SELECT, INSERT, UPDATE ON outbox TO ci_doctor_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ci_doctor_app;
