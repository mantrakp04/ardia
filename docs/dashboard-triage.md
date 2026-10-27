# Dashboard: Triage

`/triage` in the dashboard (`apps/dashboard`) shows the feedback-triage data that `ardia-db` mirrors into the `sandbox` database on the telemetry ClickHouse: requests, the reply queue, people, releases and GitHub issues. It sits behind the same Hexclave sign-in and `DASHBOARD_ALLOWED_EMAILS` allowlist as every other page.

## Credentials

The dashboard's `reader` user only sees `telemetry.*`, so triage uses its own connection, configured with env vars that `serverEnv()` reads like the rest:

| Env var | Default | Notes |
| --- | --- | --- |
| `TRIAGE_CLICKHOUSE_PASSWORD` | none | Password of the `sandbox` ClickHouse user. Without it the triage pages show "not configured" and nothing else breaks. |
| `TRIAGE_CLICKHOUSE_USER` | `sandbox` | |
| `TRIAGE_CLICKHOUSE_DATABASE` | `sandbox` | |
| `TRIAGE_CLICKHOUSE_URL` | `CLICKHOUSE_URL`, else `http://$CLICKHOUSE_HOST:8123/` | Point at `https://netnyahoo.com/_ch/` for local dev. |

In production `infra/dashboard/hexclave.deploy.ts` maps `TRIAGE_CLICKHOUSE_PASSWORD` to the Hexclave secret `DASHBOARD_TRIAGE_CLICKHOUSE_PASSWORD` (empty by default, so deploys never block on it). Set it once in the Hexclave dashboard under Project Settings > Secrets, then redeploy the dashboard (`Deploy` workflow, `service: dashboard`).

Locally, put the vars in `~/.config/ardia/dashboard.env` or export them, with `DASHBOARD_DEV_BYPASS_AUTH=1` to skip sign-in.

The `sandbox` user allows two simultaneous queries, so the dashboard runs triage queries one at a time and retries when ClickHouse reports the user busy.

## Reply actions

Mark sent, Skip and Back to queue write to ClickHouse:

1. a row in `sandbox.ardia_reply_actions` (`reply_id`, `status`, `at`, `actor` = the signed-in email), created on first use;
2. a newer version of the row in `sandbox.ardia_replies` with the new `status` and `status_at`.

`ch_sync.py` truncates and reloads `ardia_replies` from SQLite on every sync, so step 2 only lasts until the next sync. `ardia_reply_actions` is never touched by the sync, and the dashboard overlays its latest action on each reply unless SQLite later records a non-drafted status that is newer. To make an action permanent in SQLite, read it back from `ardia_reply_actions`.
