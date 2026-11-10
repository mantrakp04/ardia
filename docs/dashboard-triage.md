# Dashboard: Triage

`/triage` in the dashboard (`apps/dashboard`) shows the feedback-triage data that `ardia-db` mirrors into the `sandbox` database on the telemetry ClickHouse: requests, the reply queue, people, releases and GitHub issues. It sits behind the same Hexclave sign-in and admin gate as every other page: a verified primary email and `is_admin: true` in the user's client read-only metadata.

The dashboard's `/settings` page, which settings opted-in users change, is described in `docs/dashboard-settings.md`.

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

## Snooze

Each waiting draft has **Snooze 1 day** next to Mark sent and Skip. Snooze never changes a reply's status: it hides the draft from **Waiting** (and from the overview's waiting counts) for 24 hours, after which it shows up in Waiting again by itself. Snoozed drafts are listed under the **Snoozed** filter with a "snoozed until …" note and an **Unsnooze** button.

1. The button inserts a row in `sandbox.ardia_reply_actions` with `status = 'snooze'` (or `'unsnooze'`). The status overlay ignores these rows; the newest snooze/unsnooze press decides `snoozed_until` (press time + 24h, or none). Because `ardia_reply_actions` is append-only and never truncated, a sync can't undo a snooze.
2. `ch_sync.py` folds each press into SQLite as `replies.snoozed_until` / `replies.snooze_changed_at` (status untouched; an older press than the recorded one is skipped) and mirrors `snoozed_until` to `sandbox.ardia_replies.snoozed_until` and `ardia_v_reply_queue`. With no press on record, the dashboard falls back to that mirrored column.
3. Scripts that want "waiting and not snoozed" can use `db.WAITING_SQL`.

## Leads

**Triage › Leads** lists posts from the browser crowd on X (people leaving Arc, comparing Dia, Zen, Comet or Atlas, asking what to switch to) that the triage routine sourced, each with a drafted reply. Every lead's draft is also a normal row in the reply queue (`ardia_replies`, `source = 'lead'`, `ext_id = 'L<post id>'`), so it shows up in **Reply queue** under **Leads on X** with a `lead` pill, and Mark sent, Skip, Snooze and Recheck work on it the same way. Nothing is ever posted for you: **Reply on X** opens X's composer as a reply to the post with the draft filled in, and **Copy reply** copies it.

Each post renders with the dashboard's own post card (`components/triage/tweet-card.tsx`), not X's embed script or iframe: avatar, name, verified badge, handle, time, text with links, mentions and hashtags (`lib/tweet-text.ts`), photos and video previews, and the reply, repost, like, view and bookmark counts at sourcing time. Avatars and media load straight from X's image CDN with no referrer.

Under the card is the release video for the feature the post is about, when one exists, linked at its timestamp (`https://ardia.dev/release-videos/<id>.mp4#t=<seconds>`, a media fragment browsers seek to), with the chapter title, the release it shipped in and a note on how the timestamp was found.

The data is `sandbox.ardia_leads`, mirrored by `ch_sync.py` from the `leads` table of the ardia-db SQLite database (one row per post: author, followers and avatar, text, entities and media as JSON, metrics, the matched feature, `reply_id`, and `video_url`, `video_t`, `video_chapter`, `video_release`, `video_note`). The dashboard reads it with the reply queue; before the first sync creates the table, Leads is empty and the queue works as before.

The routine's side lives in ardia-db's `leads.py`:

1. `leads.py videos --verify` indexes the release videos linked from GitHub release notes and computes each chapter's start from its Remotion composition (`apps/videos/src/videos/<id>/index.tsx` timing constants and `segments.json`), checking the total against the mp4's real duration. A video without a composition, or whose length doesn't match, is linked without a timestamp and the lead says so.
2. The routine searches X with its own X tools, saves each raw search response under `leads-raw/`, and runs `leads.py candidates`, which drops posts already in triage, Ardia mentions, the owner's own posts, other browser makers promoting theirs, and spam, and suggests a feature and video for the rest.
3. It writes a short draft for each post worth answering and stores them with `leads.py add picks.json`, then runs `ch_sync.py`.

## Needs attention: tasks and goals

The home page uses progressive disclosure ([NN/g](https://www.nngroup.com/articles/progressive-disclosure/)): square summary cards first, full reports on click, rare controls and settled work collapsed. Labels are at most 50 characters. Keep the English short and simple.

- **Tasks** combines live health/site signals with the routine's decisions, held replies and review backlog. Existing analytics rules are unchanged in `server/sections/attention-signals.ts`; pinning a signal saves its report so it cannot vanish when the metric changes.
- **Pinned** is for goals, not copies of issues. Pin moves a task there immediately. The next routine run writes a new outcome label, visual progress/checklist and a report saying what changed, what blocks it and what comes next. Until then the card says tracking starts next run. `last_tracked_at` tells you when it was checked. Leave unknown progress null, rather than making up a percentage.
- **Done** and **Dismiss** move work into the collapsed **Settled** list, with different indicators. Reopen brings it back. Content refreshes never undo these choices.
- **Snooze** offers 1 day, 3 days, 1 week or a custom future time. Its options open in a popover, not inside the square. Snoozed work is collapsed below Tasks. It wakes automatically on the page and in the next routine run, returning to its previous Tasks/Pinned placement. Goal tracking survives the snooze. Displayed timestamps use Pacific time; custom input uses the viewer's local time.

### Data and safe previews

SQLite `attention` mirrors to `sandbox.ardia_attention`: stable string `id`, `kind`, `status` (`open|pinned|done|dismissed|snoozed`), `resume_status`, `snooze_until`, `label`, `preview_html`, `report`, `goal_label`, `goal_preview_html`, `goal_report`, `last_tracked_at`, optional `progress` (0–100), `source_links` (JSON), `created_at`, `updated_at`, `status_at` and `pinned_at`. Reports are plain text/Markdown, shown as text, never injected into the parent page.

Previews allow only headings, paragraphs, lists, chips, simple width bars and progress elements. All other tags/attributes are removed. They render in opaque-origin `iframe srcDoc` sandboxes without scripts, same-origin, forms or navigation privileges; CSP blocks remote resources. Source links accept only HTTPS or local dashboard paths. Do not put secrets or personal data into previews.

Dashboard lifecycle changes append to `ardia_attention_actions` (`id`, `status`, `at`, `actor`, `snooze_until`, `snapshot`). This action journal also records feature use. The page overlays the latest action immediately; `ch_sync.py` replays actions into SQLite before mirroring. Replays are idempotent, and newer local decisions win. This journal is never truncated. A snapshot carries a newly pinned live signal into the routine's store.

### Routine commands

The maintained sources are `apps/dashboard/pipeline/attention.py` and `ch_sync.py`. The existing bot runtime installs copies in `/workspace/ardia-db/` beside its `db.py` and `leads.py`. `ARDIA_DB_PATH` or `--db` overrides the SQLite path. No command sends messages.

```sh
cd /workspace/ardia-db
python3 attention.py pull-actions
python3 attention.py wake
python3 attention.py refresh --github
python3 attention.py needs-write
python3 attention.py newly-pinned
python3 attention.py list --status pinned
python3 attention.py upsert tasks.json
python3 attention.py goal ITEM_ID goal.json
python3 attention.py done ITEM_ID --evidence 'Verified outcome and source URL'
python3 ch_sync.py attention
```

`upsert` takes one JSON task or a list (`id`, `kind`, `label`, `preview_html`, `report`, `source_links: [{label,url}]`); `-` reads stdin. It updates content, never lifecycle. `goal` requires JSON with `goal_label`, `goal_preview_html`, `goal_report` and optional `progress`; it rejects an unchanged issue label/report. It stamps `last_tracked_at`. Both new and existing goals need fresh source checks each run.

`refresh --github` refreshes explicit current reply holds and a single contributor/bot review-backlog card from live GitHub data. A historical “hold” does not count when the latest check says UNHOLD. This is a starting summary, not proof a fix is still missing or a PR is ready: the routine must verify sources and rewrite the report. It must add other real pending decisions/asks with `upsert`, and mark verified completed outcomes with `done --evidence`. Never infer completion just because a source vanished or a telemetry query failed. Do not add unrelated personal work. Do not reopen dismissed work on refresh.

Tests: `pnpm -C apps/dashboard test` and `python3 -m unittest discover -s apps/dashboard/pipeline -p 'test_*.py'`.

### Lead sorting

Leads and the reply queue's **Leads on X** group offer **Newest** (default), **Followers** and **Views**. Metrics sort highest first, unknowns last (a known zero stays ahead of unknown). Ties use the newest post, then its ID. Other reply groups keep their order.

`leads.py` already reads followers from the author's `public_metrics.followers_count` and views from the post's `public_metrics.impression_count`. `ch_sync.py` mirrors both as nullable counts (`author_followers`, `views`) in `sandbox.ardia_leads`. To fill missing old values from saved post JSON without fetching X or inventing counts, install `apps/dashboard/pipeline/backfill_lead_metrics.py` beside `leads.py`, run `python3 backfill_lead_metrics.py`, then `python3 ch_sync.py leads`. Existing known values are not overwritten; absent metrics stay null.
