# CI Doctor

> **AI can propose. Evidence decides. Humans approve.**

CI Doctor is a Developer Tools project that turns a **real failed GitHub Actions run** into an evidence-backed, sandbox-validated pull request. It is deliberately not a chat wrapper and it never gives an AI agent direct repository write authority.

**Category:** Developer Tools
**Public proof dashboard:** https://neurosyncx7.github.io/ci-doctor/
**Verified repair artifact:** [fixture pull request #4](https://github.com/neurosyncx7/ci-doctor-fixtures/pull/4)

## The problem

A failed CI run forces developers to move from noisy logs to root cause, a safe code change, a regression test, and proof that the wider suite still passes. That work is slow; giving an autonomous coding agent unrestricted repository access is unsafe.

CI Doctor treats the model as an **untrusted proposer**. It accepts only a genuine failed workflow from an allowlisted GitHub App installation, records evidence before work begins, constrains the repair with checked-in policy, validates the patch in a disposable Docker sandbox with networking disabled, and lets a separate idempotent broker open a human-reviewable PR only after recorded validation succeeds.

## What happens in a real run

```text
GitHub Actions failure
  -> HMAC-SHA256 webhook verification + repository allowlist
  -> append-only evidence record (bounded and pattern-redacted)
  -> GPT-5.6 diagnosis + Codex repair proposal
  -> checked-in repair policy gate
  -> disposable Docker sandbox (no network, no GitHub write credential)
  -> regression test + focused test + full suite, with exit codes recorded
  -> separate idempotent GitHub App broker opens a PR for human review
```

The included proof run is incident `7491174d-8ea0-4c35-b423-27b78c6f892a`. It recorded a real `Fixture CI` failure, produced a policy-compliant patch, passed focused and full-suite validation in Docker, and resulted in [PR #4](https://github.com/neurosyncx7/ci-doctor-fixtures/pull/4), authored by `ci-doctor-demo[bot]`.

## Safety model

| Boundary | What CI Doctor enforces |
| --- | --- |
| Webhook intake | Validates GitHub's `sha256=` HMAC using a shared webhook secret with a timing-safe comparison; only explicitly allowlisted repositories are eligible. |
| Evidence | Persists an append-only, correlated event trail before downstream side effects. Evidence is bounded and pattern-redacted for common token, password, GitHub, Slack, and AWS-key forms. Treat this as defense in depth, not a promise that arbitrary secrets can never appear. |
| Model scope | GPT-5.6 and Codex receive bounded, sanitized evidence and can propose a structured diff. They do **not** receive GitHub write credentials. |
| Policy | A checked-in `ci-doctor.policy.json` restricts commands, autonomous write paths, protected paths, changed files/lines, wall time, and attempts. A patch must add or strengthen a regression test. |
| Execution | Target code runs only in a disposable Docker workspace with `--network none`, a read-only base, dropped Linux capabilities, and no GitHub credential. |
| Publication | The sandbox cannot create a PR. A separate idempotent GitHub App broker opens a PR only after recorded focused and full-suite success. Nothing auto-merges. |

CI Doctor stops and records the result if a patch touches a protected path, exceeds policy budget, repeats its failure signature, or cannot produce recorded validation evidence. A stopped attempt creates no PR.

## Judge quickstart - no local rebuild required

1. Open the permanent [public proof dashboard](https://neurosyncx7.github.io/ci-doctor/). It contains a **recorded, verified** incident and its evidence rail; it does not pretend to be an always-on worker.
2. Open [PR #4](https://github.com/neurosyncx7/ci-doctor-fixtures/pull/4) to inspect the actual bot-authored pull request, patch, regression test, and checks.
3. Watch the public demo video submitted with this project for the end-to-end live workflow.

The public Pages site is deliberately credential-free and can remain online when the live worker is offline. It never contains GitHub App keys, database credentials, webhook secrets, or model credentials.

## Run a live end-to-end incident locally

This path executes a real local worker and receives a real GitHub Actions `workflow_run` webhook. It is intended for reviewers who want to operate the complete system rather than inspect the recorded proof.

### Supported platform

The scripted demo is verified on **Windows 11, PowerShell, Node.js 22+, Docker Desktop, and GitHub Actions**. A Node 22 + Docker environment on another operating system may work, but is not part of the tested launch script.

### Prerequisites

- Node.js 22 or newer (`node --version`)
- Docker Desktop running
- A GitHub App installed on the fixture repository, subscribed to `workflow_run`
- A GitHub webhook secret and GitHub App private key
- A PostgreSQL Docker image (started automatically by the launcher)
- Either an authenticated Codex CLI session (`CI_DOCTOR_MODEL_PROVIDER=codex_cli`) **or** a project-scoped OpenAI API key (`CI_DOCTOR_MODEL_PROVIDER=openai`)
- An HTTPS tunnel such as Cloudflare Tunnel so GitHub can reach your local API

### 1. Clone and install

```powershell
git clone https://github.com/neurosyncx7/ci-doctor.git
cd ci-doctor
npm ci
Copy-Item .env.example .env
```

Edit `.env` privately. Never commit it. At minimum set strong database/app passwords, `GITHUB_WEBHOOK_SECRET`, `GITHUB_ALLOWED_REPOSITORIES`, GitHub App credentials, and one model-provider configuration. See [`.env.example`](.env.example) for every variable.

### 2. Start the local repair system

Open Docker Desktop and wait for its engine to say it is running. Then run:

```powershell
cd "C:\path\to\ci-doctor"
powershell -ExecutionPolicy Bypass -File .\scripts\live-demo.ps1
```

The launcher starts PostgreSQL, migrations, the API, evidence-ingestion worker, diagnosis worker, repair worker, and dashboard. Open http://127.0.0.1:4311 and select **Console**.

In a second PowerShell window, expose the API over HTTPS:

```powershell
cloudflared tunnel --url http://127.0.0.1:4300
```

Copy the temporary `https://...` URL printed by Cloudflare. In your GitHub App settings set the webhook URL to:

```text
https://YOUR-TUNNEL-URL/webhooks/github
```

Keep the existing webhook secret and subscribe to `workflow_run` events. Quick-tunnel URLs expire when the tunnel stops, so update this setting whenever Cloudflare gives you a different URL.

### 3. Verify before triggering CI

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-live-demo.ps1
```

It must print `CI Doctor live-demo prerequisites are ready.`

### 4. Trigger a real eligible failure

The sample target is [`fixtures/ci-doctor-fixtures`](fixtures/ci-doctor-fixtures), an intentionally broken Node.js repository with four independent real defects:

1. null / optional-value handling;
2. pagination off-by-one behavior;
3. stale asynchronous-response ordering; and
4. an external-status type assumption.

On GitHub, open the installed fixture repository, go to **Actions -> Fixture CI**, and use **Re-run failed jobs** for a failed run. CI Doctor only responds to a genuine failed, allowlisted workflow; uploading a random file is intentionally not a trigger.

The Console refreshes its append-only event ledger every 2.5 seconds. A valid incident progresses from signature verification and evidence sealing to diagnosis, policy-gated repair, Docker validation, and - only when all required checks pass - a broker PR. Use the **Docker proof** stage and **Sandbox Validation Ledger** to inspect recorded focused/full-suite exit evidence.

## Local verification

The fixture baseline is intentionally failing until CI Doctor repairs it; this confirms the source signal is real:

```powershell
npm.cmd run test:fixture
```

Run the product checks:

```powershell
npm.cmd run test:api
npm.cmd run build:api
npm.cmd run build:dashboard
$env:CI_DOCTOR_DOCKER_TEST = '1'
npm.cmd run test:docker
Remove-Item Env:CI_DOCTOR_DOCKER_TEST
```

`test:docker` requires Docker Desktop. Its integration tests assert a network-isolated, read-only container and an approved patch applied only in a disposable writable workspace.

## Where GPT-5.6 and Codex were used

CI Doctor uses the model as an agent with a constrained job, not as a general-purpose chat interface:

- **GPT-5.6** performs structured diagnosis from bounded, redacted CI evidence: it connects failure signatures to relevant source and test context and returns an evidence-linked hypothesis.
- **Codex** is the repair agent: it turns that constrained diagnosis into a structured patch and regression-test proposal. The patch is only a proposal until Docker records passing focused and full-suite results.
- **Codex accelerated the build workflow** by helping scaffold strict TypeScript API boundaries and Zod schemas, generate focused test cases, trace failure-to-source context, iterate on the dashboard interaction states, and maintain the repository's `AGENTS.md` conventions. Human decisions set the safety architecture: broker-only GitHub writes, no secrets in the dashboard, explicit policy budgets, and Docker as the execution authority.
- **Subagent-ready design:** independent failure clusters can be diagnosed in parallel, while each resulting patch remains independently policy-checked and validated. The included incident keeps the final publication path serialized through the idempotent broker.

The important design choice is that neither GPT-5.6 nor Codex decides that a repair is true: recorded sandbox command results do.

## Repository map

| Path | Purpose |
| --- | --- |
| `apps/api/` | Fastify API, webhook verification, redaction, event persistence, workers, policy, Docker sandbox, and PR broker. |
| `apps/dashboard/` | Operator dashboard and permanent public proof view. |
| `fixtures/ci-doctor-fixtures/` | Deliberately broken Node fixture used for real end-to-end demonstrations. |
| `benchmarks/` | Capability-ladder harness and reviewed failure-mode taxonomy; reports remain empty until real benchmark artifacts exist. |
| `infra/postgres/` | Local PostgreSQL compose configuration. |
| `scripts/` | Live-demo launcher and readiness verification. |
| `AGENTS.md` | Conventions, testing obligations, and safety boundaries followed by Codex contributors. |

## Availability and scope

The free GitHub Pages proof view is permanent. The full live engine requires an active local host (or a securely deployed equivalent), Docker, GitHub webhook reachability, and an authenticated model provider. This is an intentional deployment boundary - not a fabricated always-online claim.

CI Doctor is a security-first proof of a production architecture. It supports policy-equipped Node 22 repositories today; it does not claim to safely repair arbitrary files from arbitrary repositories or to autonomously merge into production.

## License

Released under the [MIT License](LICENSE).
