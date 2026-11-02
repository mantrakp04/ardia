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

## Recheck

Each waiting draft has a **Recheck** button, and the toolbar has **Recheck all N** for every waiting draft in the current filter and search that isn't already queued. Recheck never changes a reply's status. It asks the next scheduled triage run to re-verify the draft (is the fix still in a build, was it reverted, did someone already answer, is the version wording current) so it gets fixed up without a back and forth.

1. The button inserts a row in `sandbox.ardia_reply_actions` with `status = 'recheck'` (same table, `at` and `actor` as the other buttons). The status overlay ignores `recheck` rows.
2. The card shows a **recheck queued** pill until the draft has been re-checked after the press, plus "checked 3h ago" (or "never checked") from `last_checked_at`.
3. `ch_sync.py` folds each `recheck` action into SQLite before it reloads ClickHouse: it sets `replies.needs_recheck = 1` and `replies.recheck_requested_at` to the press time, leaves `status` and `status_at` alone, and skips a press that is already recorded or older than `last_checked_at`. The action watermark (`state.ch_reply_actions_applied_at`) advances as for any other action.
4. The routine lists flagged drafts with `python3 recheck_replies.py list` (`--json` for machine use), re-verifies and edits them, then runs `python3 recheck_replies.py clear ID … [--note "…"]` (or `clear --all`), which sets `last_checked_at` to now and `needs_recheck` back to 0. `recheck_replies.py touch ID …` stamps `last_checked_at` without a flag. The next `ch_sync.py` run mirrors the result and the pill clears.

`needs_recheck` (UInt8), `recheck_requested_at` and `last_checked_at` (nullable DateTime64) are columns of `sandbox.ardia_replies` and of the `ardia_v_reply_queue` view. `ch_sync.py` adds any column missing from an existing ClickHouse table on start, so older mirrors pick them up without a rebuild.
