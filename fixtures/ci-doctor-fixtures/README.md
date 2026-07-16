# CI Doctor fixture repository

This repository is intentionally broken. Its failures model independent production defects that appear in ordinary JavaScript services.

| Failure cluster | Trigger | Expected behavior |
| --- | --- | --- |
| `profile` | A user has no display name | A safe fallback label is returned. |
| `pagination` | An item count crosses an exact page boundary | The final partial page is included. |
| `search-session` | An older request resolves after a newer request | The newest request owns the displayed result. |
| `status-label` | An external provider sends a numeric status | The status is normalized safely. |

`npm.cmd test` must fail on the initial commit. CI Doctor should repair the production code, add or strengthen regression coverage, validate the suite, and propose a pull request.

