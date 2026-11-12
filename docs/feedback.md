# Feedback and telemetry

How Ardia (app and CLI) knows who hit a problem, what they saw, and whether the fix held. This is the
contract the app, the CLI, the feedback service and the dashboard build against. Change it here first.

## Identity

- **Install id** (`installId` in `telemetry.json`): a random UUIDv4 from the native secure source, made at
  the first opt-in or first report and then kept for life. Updates, downgrades, sharing toggles and newer
  file formats never change it. Only Settings › Privacy › "Reset my anonymous ID" replaces it. Nothing is
  sent with it while sharing is off, except a report the user sends and the 14-day watch they opt into.
- **Session id**: a UUIDv7 made at each app launch, sent as `$session_id` on every app event and saved as
  `sessionId` in `telemetry.json` while the app runs. CLI events carry the app's `sessionId` when the app
  session is open, else a UUIDv7 per CLI process.
- **Name and avatar**: `packages/core/src/anonymousIdentity.ts` turns an id into `{ name, avatar }`.
  Name: adjective + animal ("Brave Otter"). Avatar: three colours and an angle for a gradient blob. Pure and
  deterministic; never stored, never sent. The app, the feedback service and the dashboard all use it.
- **Daily count** (`daily_active`) stays unlinkable: a fresh id per ping.

## Events

- Every app event: `$session_id`, plus the existing common properties. CLI: the same.
- Ingest key: every POST to `/otel/v1/logs` and `/api/feedback` sends `X-Ardia-Key`. Keys are public
  constants, one per surface (app, CLI, site), bundled in the code; they are not secrets. nginx rejects an
  unknown key with 403. A missing key on `/otel/v1/logs` is still accepted while builds without one are in
  the field and is recorded as `ingest_key=missing`; `/api/feedback` requires one.

## Local copy (7 days)

- Everything the app builds as an event or log line, sent or not (sharing off included), is appended to
  `<data dir>/Telemetry/local/<UTC day>.jsonl`, one record per line with `sent` true or false.
- Kept 7 days, capped at 8 MB in total (oldest lines go first), pruned at launch and hourly. Writes are
  batched (every 10 s, at quit, and at once for a crash) and never block the UI thread.
- The CLI keeps its own copy in the same folder as `cli-<UTC day>.jsonl`, 7 days, 4 MB.
- It leaves the Mac only when sharing is on (as the normal events) or when the user attaches it to a report.
- It measures itself: an hourly `telemetry_local_store` event with bytes, lines, files, write time p95,
  prune time, lines dropped for the cap, queue bytes, bytes posted, failed posts. A regression here is a bug.

## 14-day watch

- A report from someone with sharing off can opt in to "Help confirm the fix: share crash reports and usage
  for 14 days". That turns sharing on with `sharingUntil` (14 days) and `watchReport` (`FB-…`) in
  `telemetry.json`. Every event during it carries `watch_report`. At `sharingUntil` sharing turns itself off
  and the app says so once. Settings shows the end date and lets them stop early.
- Reports from people who already share are watched for 14 days without asking.

## Feedback service (`infra/feedback`, behind nginx at `/api/feedback`)

1. `POST /api/feedback` with `X-Ardia-Key`, JSON:
   `kind` (`bug` | `slow` | `idea` | `other`), `title` (1–67 characters, trimmed), `description`
   (1–4000), `source` (`app` | `cli`), `install_id` (when sharing is on or a watch is chosen; otherwise a
   one-time UUID), `session_id`, `app_version`, `app_build`, `channel`, `os_version`, `arch`,
   `cli_version`, `contact` (≤200, optional), `page_address` (≤2048, optional), `watch_days` (0 or 14),
   `diagnostics` (object, ≤64 KB), `attachments` (list of `{ name, bytes, type }`).
   Answers `201 { id: "FB-XXXX", name, upload_token, upload_urls, expires_at }`.
2. `PUT /api/feedback/<id>/files/<name>` with `Authorization: Bearer <upload_token>` for each attachment,
   streamed to SeaweedFS at `feedback/<id>/<name>`, on `ardia-feedback-objects` (a service of its own, defined
   in `infra/feedback/hexclave.deploy.ts`, that the replays never write to). Caps: recording 100 MB, trace
   50 MB, other files 10 MB.
   Names: `recording.mp4`, `trace.json.gz`, `local-events.jsonl.gz`, `crash-<n>.ips`, `attachment-<n>.<ext>`.
3. `POST /api/feedback/<id>/complete` (Bearer): writes a `feedback_submitted` event (all fields above, the
   attachment list, `watch_until`, `issue_number`, `issue_url`) through the collector, with `distinct_id`
   the install id or the one-time id, and opens a GitHub issue. Answers `{ id, name, issue_url }`.
- The GitHub issue is public: title, description (scrubbed of emails, keys, URL queries and home paths),
  kind, version, macOS, the reference and a link to the private dashboard page. Attachments, contact,
  page address and diagnostics never go to GitHub. The form says so.
- Issue labels follow the repo's rule: `feedback` on every report, plus `bug` for bug and slow,
  `enhancement` for idea, and nothing more for other.
- Without `GITHUB_ISSUES_TOKEN` it skips the issue and still stores the report. Production runs that way for now. To turn issues on, create the Hexclave secret `FEEDBACK_GITHUB_ISSUES_TOKEN` (fine-grained, Issues read and write on `ardia-browser/ardia`), add `GITHUB_ISSUES_TOKEN: secret(SECRETS.feedbackGithubIssuesToken)` back to `infra/feedback/hexclave.deploy.ts`, create the `feedback` label, and redeploy with `infra/feedback/deploy.sh`.
- Kept forever for now, like all telemetry.
- Storage: `ardia-feedback-objects` has a 10 GB volume of 18 volumes of 512 MB (so the largest file, 100 MB, fits
  and the volumes can't outgrow the disk), and no expiry. Reports were first kept on `ph-objects`, the
  replays' SeaweedFS, and from 11-11 every report there got `502 upstream:storage` (`report_failed` with
  `error_class` `storage`), none was sent. The replays, kept 30 days at a sample rate of 1, were about 19 GiB
  of its 20 GB by then. Reports saved before the move (11-09 to 11-11) stay on `ph-objects` under
  `buckets/feedback/`, and the dashboard still reads them there. A 502 `upstream:storage` in `report_failed`
  or `failed (storage)` in the `ardia-feedback` log means the report store is refusing writes: look at the free
  space of `ardia-feedback-objects`.
- Deploying this is a manual step: `infra/feedback/deploy.sh` (CI has no job for it) creates the store and
  points the server at it. Run it before the dashboard deploys (the dashboard points at the store's host), then
  redeploy the dashboard so it reads from it.
- `node infra/feedback/server.mjs --local <dir>` runs it with no ClickHouse, SeaweedFS or GitHub, writing
  to `<dir>`, for tests. The app reads `ARDIA_FEEDBACK_URL`, the CLI `ARDIA_FEEDBACK_URL` too.

### Local mode

```
node infra/feedback/server.mjs --local ~/ardia-scratch/feedback   # http://127.0.0.1:4319
ARDIA_FEEDBACK_URL=http://127.0.0.1:4319                          # in the app's or the CLI's env
```

- `ARDIA_FEEDBACK_URL` is an origin, without a path: clients POST to `$ARDIA_FEEDBACK_URL/api/feedback`.
  Unset, it is `https://ardia.dev`. Local mode serves the same paths as production.
- Options: `--port <n>` (default `$PORT`, else 4319), `--host <addr>` (default 127.0.0.1), `--rate-limits` (off
  in local mode). `FEEDBACK_UPLOAD_SECRET` is optional there; without it a secret is made once and kept in
  `<dir>/.upload-secret`, so tokens survive a restart. `--help` lists the production env.
- It checks everything production checks, `X-Ardia-Key` included (the app key with `source: app`, the CLI key
  with `source: cli`; keys in `packages/core/src/ingestKeys.ts`).
- `upload_urls` is an object, attachment name → absolute URL to PUT. Every PUT must send exactly the declared
  `bytes` (else 400 or 413). The token lasts 24 hours and only works for its own report.
- Errors are `{ error, message }`: 400 `invalid` (the message names the field), 401 `token_*`, 403 `bad_key`,
  404, 409 `completed` (a PUT after complete), 413, 415 (not JSON), 429 `rate_limited`, 502 `upstream:<backend>`
  (`upstream:storage`, `upstream:collector` or `upstream:issues`, with `backend`, `retryable: true` and
  `Retry-After: 60`), 500 `internal` (a bug in the service). Every 5xx is logged as
  `[feedback] <method> <path> failed (<backend or internal>): <stack>`, with the filer's or collector's own reason.
  Complete is idempotent: repeat it after a failure and it answers the same.
- Only storage is required. Complete answers success when GitHub fails (the report keeps `issue_error`, no
  issue) and when the collector fails: `complete.json` keeps `event_sent: false`, the service retries the event
  in the background (30 s, 2 min, 10 min, 30 min, then hourly, 8 tries), and a later complete of the same report
  sends it if the service restarted meanwhile. Storage down answers `upstream:storage`, and the app retries.
- What lands in `<dir>`: `feedback/<id>/report.json` (the report as stored), the uploaded files,
  `issue.md` (the would-be public issue, already scrubbed), `event.json` (the exact OTLP request the
  collector would get) and `complete.json`, plus every event appended to `events.jsonl`. `issue_url` is a
  `file://` link to `issue.md`.
- Tests: `node --test` in `infra/feedback`.

## Report a Problem (app)

Help › Report a Problem… (⌥⇧⌘I) and the New Tab check-in banner open it. It replaces Send Feedback and
Record Performance Issue; Copy Diagnostics stays.

- Kind · Title (live counter, 67 max) · What happened? (required) · Record the problem (with "Include web
  pages", unticked, chosen before recording) · Slow adds a 30-second capped trace · Attached (one summary
  row, expands in place below itself with checkboxes and a preview, never over the recording options; watching the recording folds it) · the 14-day watch (sharing off only) · Contact (optional).
- Fits the default window without scrolling. Send needs a title and a description (the service requires both). Send
  stays enabled while the draft is incomplete: pressing it outlines each missing field in red with its hint ("Add a
  title to send", "Say what happened to send"), which clears as the field is filled, and counts `report_send_blocked`
  (`reason`: the first problem, `problems`, `kind`).
- Recording: Ardia's windows only, 60 s max, web page areas blacked out in every frame unless included,
  watched before sending.
- Sent screen: the reference, the GitHub issue link, "You appear to us as <name>", and the watch end date.

## CLI

`ardia feedback --title "…" [--kind bug|slow|idea|other] [--attach FILE]… "description"` (or stdin). Same
endpoint and rules; prints the reference, the issue link and the name. "Sent" only after a 2xx. Scrubbing
uses exact secret patterns, never a cut at a keyword.

## Dashboard

- `/people` (People; `/users` stays the aggregate Users page): every install with name, avatar, last seen,
  version, channel, crashes, reports.
- `/people/<install id>` (`/users/<install id>` redirects there): header (current version, Mac, channel,
  sharing), reports, and a timeline grouped by session. Everything else links here.
- `/feedback`: the inbox with kind, person, signals (recording, trace, watching) and fix status (issue open /
  fixed in <version> / not seen since <version> / came back), and `/feedback/<id>` with the recording.
- `/regressions`: each tracked number, this version against the last on the same channel, worse ones flagged
  and linked to the people affected.
- CLI exceptions show on Errors and Health with the app's.
- Attachments are read through the dashboard at `/files/feedback/<id>/<name>` (admin only), from SeaweedFS
  `buckets/feedback/` on `FEEDBACK_OBJECTS_HOST` (`ardia-feedback-objects`), or `FEEDBACK_FILES_URL`
  (+ `FEEDBACK_FILES_TOKEN`) when set. A file that isn't there is looked for next on `REPLAYS_HOST`, where
  reports saved before the move are (`apps/dashboard/src/server/feedback-files.ts`).
  `DASHBOARD_FEEDBACK_FIXTURE=<json>` adds local synthetic reports in dev only.
