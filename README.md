# CI Doctor

CI Doctor is an event-driven repair system that turns a failed CI run into an evidence-backed, sandbox-validated pull request.

## Phase 1: target fixture

`fixtures/ci-doctor-fixtures` is a small, intentionally broken Node.js repository. It provides four independent, realistic failure clusters for CI Doctor to ingest and repair:

1. A null/optional-value handling failure.
2. A pagination off-by-one error.
3. An out-of-order asynchronous response race.
4. An external-status type assumption.

Run its baseline locally:

```powershell
Set-Location fixtures/ci-doctor-fixtures
npm.cmd test
```

The command must initially fail. That is the source signal CI Doctor will later receive from GitHub Actions; it is not a mocked dashboard state.

## Live repair proof

CI Doctor produced a real, sandbox-validated repair PR for the fixture repository: [PR #4](https://github.com/neurosyncx7/ci-doctor-fixtures/pull/4). The repair recorded four focused passing tests and a passing four-test full suite inside the sealed Docker sandbox before the broker opened the PR.

The protected workflow bootstrap was intentionally separated from the agent repair scope: CI Doctor may only alter `src/**` and `test/**`; it never changes CI configuration or dependencies as part of an autonomous repair.

## Dashboard

The Phase 6 dashboard is a compact incident cockpit built around that verified run—not mock metrics. It presents the incident timeline, evidence-bound patch rationale, sandbox policy boundary, and the real PR/check result.

```powershell
npm.cmd run dev:dashboard
```

Open `http://127.0.0.1:4311`. Build a production bundle with `npm.cmd run build:dashboard`.
