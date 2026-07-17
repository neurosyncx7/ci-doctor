# CI Doctor live demonstration

CI Doctor responds to a real, signed GitHub Actions failure. It never scans or edits an arbitrary uploaded file. A repository must be installed in the GitHub App, present in `GITHUB_ALLOWED_REPOSITORIES`, and contain `ci-doctor.policy.json` to be eligible for autonomous repair.

## Before the demonstration

1. Open Docker Desktop. Wait until it says the engine is running.
2. Keep the existing `.env` and `.secrets` files private. Do not paste them into a browser, chat, or video recording.
3. From PowerShell, start an HTTPS tunnel so GitHub can reach the local API:

```powershell
cloudflared tunnel --url http://127.0.0.1:4300
```

4. Copy the `https://...` address printed by Cloudflare. In the GitHub App settings, set the webhook URL to `https://YOUR-ADDRESS/webhooks/github` and subscribe to `workflow_run` events.

## Launch

```powershell
cd "C:\Users\VISHAL\OneDrive\文档\codex"
powershell -ExecutionPolicy Bypass -File .\scripts\live-demo.ps1 -PublicWebhookUrl https://YOUR-ADDRESS
```

The launcher performs a Docker preflight, starts PostgreSQL and migrations, then opens five visible terminals: API, evidence ingestion, diagnosis, repair, and the dashboard.

Verify the local prerequisites:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-live-demo.ps1
```

Open `http://127.0.0.1:4311` and choose **Console**.

## Run a real incident

1. In GitHub, open `neurosyncx7/ci-doctor-fixtures`.
2. Open **Actions**, choose **Fixture CI**, then choose **Re-run failed jobs**. Do not upload a random file: a real failed CI run is the deliberate trigger.
3. Watch the dashboard. Its live incident view polls the append-only ledger every 2.5 seconds. You will see signed failure acceptance, evidence ingestion, clustered failures, model diagnosis, repair attempts, validation exit codes, and a PR record if validation passes.
4. In the visible repair terminal, confirm that source is checked out without executing it on the host. Repository tests execute only in the Docker sandbox with network disabled.
5. If a patch passes focused tests and the complete suite, CI Doctor’s separate broker opens a reviewable PR. If it does not, the ledger records the failed attempt or policy rejection. It never shows a made-up green result.

## What the system supports

The repair worker is intentionally policy-driven rather than “fix any file.” A new repository can participate only when it has:

- A real GitHub Actions failure and GitHub App installation.
- An allowlisted repository name.
- A checked-in `ci-doctor.policy.json` with allowed commands, allowed write paths, protected paths, and budgets.
- A supported sealed runtime. The included production path is `node22`; other runtimes are rejected for human review until a dedicated hardened sandbox image is added.

This is a security feature. “Any file from any repo” is not a safe product claim.

## Judge narration

“This is a view of our real event ledger, not an animation. Each event is correlated to the incident. GPT-5.6 produces structured diagnoses and patch proposals, but Docker owns the test result. The code-execution sandbox has no network and no GitHub write token; a separate idempotent broker can open a PR only after validation.”
