ALTER TABLE diagnosis_findings
  ADD COLUMN IF NOT EXISTS next_action text
  CHECK (next_action IN ('EXECUTE_REPAIR', 'NEEDS_MORE_EVIDENCE', 'ESCALATE_HUMAN'));

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS head_branch text
  CHECK (head_branch IS NULL OR length(head_branch) BETWEEN 1 AND 255);

CREATE TYPE repair_run_state AS ENUM (
  'PENDING',
  'RUNNING',
  'VALIDATED',
  'PR_OPENED',
  'NEEDS_REVIEW',
  'BUDGET_EXHAUSTED',
  'VALIDATION_FAILED',
  'UNSAFE_REPOSITORY'
);

CREATE TABLE repair_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL UNIQUE REFERENCES incidents(id) ON DELETE RESTRICT,
  state repair_run_state NOT NULL DEFAULT 'PENDING',
  source_sha char(40) NOT NULL CHECK (source_sha ~ '^[0-9a-f]{40}$'),
  branch_name text CHECK (branch_name ~ '^ci-doctor/[a-z0-9-]+$'),
  pull_request_number integer CHECK (pull_request_number > 0),
  pull_request_url text CHECK (pull_request_url ~ '^https://github.com/'),
  lease_token uuid,
  leased_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX repair_runs_dispatch_idx ON repair_runs (state, created_at)
  WHERE state IN ('PENDING', 'RUNNING');

CREATE TABLE repair_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_run_id uuid NOT NULL REFERENCES repair_runs(id) ON DELETE RESTRICT,
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  state text NOT NULL CHECK (state IN ('VALIDATED', 'REJECTED', 'VALIDATION_FAILED', 'BUDGET_EXHAUSTED')),
  reason_code text,
  patch_sha256 char(64) NOT NULL CHECK (patch_sha256 ~ '^[0-9a-f]{64}$' OR patch_sha256 = ''),
  visible_summary text NOT NULL CHECK (length(visible_summary) BETWEEN 1 AND 1500),
  targeted_exit_codes jsonb,
  full_suite_exit_code integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repair_run_id, attempt)
);

GRANT SELECT, INSERT, UPDATE ON repair_runs TO ci_doctor_app;
GRANT SELECT, INSERT ON repair_attempts TO ci_doctor_app;
