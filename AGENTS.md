# CI Doctor contributor guidance

## Purpose

CI Doctor turns a real failed CI run into an evidence-backed, sandbox-validated pull request. Never simulate a failure, diagnosis, patch, test result, or pull request in the product UI.

## Repository layout

- `fixtures/ci-doctor-fixtures/` is the intentionally broken target repository used for end-to-end runs.
- Future product services must treat fixture source as untrusted code and run it only in an isolated execution environment.

## Engineering conventions

- Use TypeScript for product code with strict compiler settings. Keep external API payloads schema-validated at the boundary.
- Model workflow changes as explicit state transitions. Persist an append-only event before publishing any side effect.
- Every event, artifact, sandbox attempt, and GitHub side effect must carry an incident ID and correlation ID.
- GitHub writes must go through an idempotent broker. Sandboxes must never receive GitHub write credentials.
- Prefer small, reviewable functions and deterministic tests. Do not introduce mock-only production paths.

## Testing standards

- A repair must add or strengthen a regression test before it can be proposed.
- Run the narrow failing test first, then the fixture's complete test suite.
- Do not mark an incident resolved based on model output; require recorded command exit status and test artifacts.
- Fixture tests are intentionally failing until CI Doctor repairs them. When checking baseline behavior, a non-zero `npm.cmd test` is expected.

## Safety boundaries

- Do not execute target-repository commands on the host in production. The local fixture baseline is the sole Phase 1 exception.
- Never expose credentials, tokens, raw secret-like log content, or hidden model reasoning in the dashboard.
- Stop autonomous repair when a command exceeds its budget, a failure signature repeats, or a protected path would change.

## Required verification

Before handing off a change, run the narrowest relevant test and then the full available suite. Report exact commands, exit codes, and whether failure is expected or unexpected.
