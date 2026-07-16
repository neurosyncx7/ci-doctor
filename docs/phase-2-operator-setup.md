# Phase 2 operator setup

CI Doctor accepts only signed GitHub App webhooks and never accepts a personal access token. Configure a dedicated GitHub App with the smallest permission set required for evidence ingestion.

## GitHub App configuration

- Install the app on the single fixture repository only.
- Repository permissions: **Actions: read-only**, **Contents: read-only**, **Metadata: read-only**.
- Subscribe only to the **Workflow run** webhook event.
- Generate a dedicated webhook secret of at least 32 random bytes.
- Generate and store the GitHub App private key in the secret manager or local `.env`; never commit it.

PR and contents-write permission are intentionally deferred to Phase 5. The ingestion worker has no authority to alter a repository.

## Local secure runtime

1. Install Docker Desktop or PostgreSQL 16. Docker is preferred because the provided compose profile binds PostgreSQL only to `127.0.0.1`.
2. Copy `.env.example` to `.env` and replace every placeholder. Generate the encryption key with PowerShell:

   ```powershell
   [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
   ```

3. Start the database with `npm.cmd run db:up`.
4. Start the API with `npm.cmd run dev:api` and the worker with `npm.cmd run worker:ingest`.
5. Put only `/webhooks/github` behind a TLS-terminating public ingress. Keep the API process bound to `127.0.0.1`; do not expose PostgreSQL or the worker.

For a demonstration tunnel, add an ingress allowlist and preserve the original source IP at the gateway. Production ingress must enforce TLS, request-size limits, WAF/rate controls, and GitHub webhook signature verification remains mandatory inside CI Doctor.

## Security evidence to show judges

- The public endpoint rejects a bad signature before any database write.
- The app database role cannot create schemas, delete incidents, or alter evidence.
- Webhook bodies are hashed for delivery audit, not stored as raw customer data.
- CI logs are redacted before storage, then encrypted with AES-256-GCM at rest.
- The worker receives an installation-scoped, short-lived GitHub token; it has no write permission in this phase.
