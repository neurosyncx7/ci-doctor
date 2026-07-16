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

