# CI Doctor capability ladder

This is a benchmark, not a marketing counter. Each case must be a pinned buggy commit in one of the small fixture repositories specified in `ladder.json`. The runner creates a fresh detached worktree, launches a fresh Codex process, enforces the case test command, and retains reviewable artifacts.

## What is measured

- pass/fail and wall-clock time;
- hint level required to unlock a success;
- visible Codex output and tool summaries only—never hidden reasoning;
- exact patch diff;
- focused/full test exit status; and
- a reviewed failure-mode taxonomy.

The taxonomy distinguishes symptom-patching, test-gaming, scope-blindness, give-up-too-early, and environment-blocked failures. Labels are evidence-backed review aids, not automatically claimed research conclusions.

## Seeding requirements

Before a run, replace each `BUGGY_REF_REQUIRED` in `ladder.json` with the immutable buggy commit SHA in its fixture repository. Keep one case per commit; do not reuse a working directory between cases. Each fixture needs its own `AGENTS.md` defining allowed commands and protected paths.

## Run protocol

```powershell
# Baseline: no hint, agents guidance present
$env:BENCHMARK_CASE='commerce-null-profile'
npm.cmd run benchmark:run

# Hint curve: re-run the same immutable buggy commit with one disclosed hint
$env:BENCHMARK_HINT_LEVEL='1'
npm.cmd run benchmark:run

# Ablation: same case and commit, but without AGENTS.md guidance
npm.cmd run benchmark:run -- --without-agents

# Aggregate only completed run artifacts
npm.cmd run benchmark:report
```

Do not report a solve rate, average hint budget, or ablation result until the run artifacts exist. The generated report is intentionally empty until real runs have been completed.
