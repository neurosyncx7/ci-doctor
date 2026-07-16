ALTER TABLE outbox ADD COLUMN IF NOT EXISTS github_installation_id bigint;

CREATE INDEX IF NOT EXISTS outbox_installation_dispatch_idx
  ON outbox (github_installation_id, available_at, created_at)
  WHERE completed_at IS NULL;

-- Tenant-scoped access is applied to customer-facing read models in Phase 6,
-- after authenticated user identity is introduced. Worker tables remain service-only.
