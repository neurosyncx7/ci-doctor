# Free public dashboard: GitHub Pages

The public CI Doctor interface is deployed with GitHub Pages. GitHub Pages is available on GitHub Free for public repositories and does not require a payment method.

## Public URL

After the workflow completes, the dashboard URL is:

`https://neurosyncx7.github.io/ci-doctor/`

## One-time GitHub setting

In `neurosyncx7/ci-doctor`, open **Settings -> Pages** and set **Source** to **GitHub Actions**.

## Live-data connection

GitHub Pages only hosts the user interface. It never receives repository credentials, model credentials, or database credentials.

The worker/API machine exposes the safe dashboard read model at an HTTPS URL. Set that URL, without a trailing slash, as the repository Actions variable `CI_DOCTOR_API_ORIGIN`:

1. Repository **Settings -> Secrets and variables -> Actions -> Variables**.
2. Create variable: `CI_DOCTOR_API_ORIGIN`.
3. Value: `https://your-api-host.example`.
4. Re-run **Publish CI Doctor dashboard**.

The API accepts browser requests only from `https://neurosyncx7.github.io`, via `DASHBOARD_ALLOWED_ORIGINS`. Never put GitHub App keys, database URLs, webhook secrets, encryption keys, or model keys into Pages variables.

## Honest availability boundary

The Pages URL is permanent and free. The real repair engine remains live only while its host is running. With no paid model/API access, that host is this computer using the existing signed-in Codex CLI. The dashboard shows a clear API-offline state rather than fabricating a workflow whenever that host is stopped.