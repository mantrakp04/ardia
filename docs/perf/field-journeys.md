# Field journeys (real-user timing)

What the app measures on users' Macs for the four sprint journeys ([sprint.md](sprint.md)), and the ClickHouse queries
that read them per release. Only with diagnostics sharing on (Settings › Privacy & Security); with it off nothing is
timed, no event monitor runs and pages aren't asked for paint times. Turning it off stops every open page's reporting at
once, drops what's in flight (a launch that saw it off is never sent), and a JS reload always tells native the current
state, while the old bridge going away turns native timing off. Everything sent is a duration, a count or a rough
range: never a URL, a title, or what was typed.

Code: `apps/browser/src/state/telemetry/journeys.ts` (journeys, aggregation, events), `packages/ardiacore/ios/ArdiaFieldTiming.mm`
(native marks), hooks in `Omnibox.tsx`, `main.tsx`, `ArdiaWebView+Navigation.mm` and `page_script.js` (› Field timing).

## How a journey is timed

Every journey starts at the user's key down or click as the window server stamped it (`NSEvent.timestamp`, through a
local event monitor; launch starts at process start) and ends when the result is on screen. Steps are cumulative from
the start unless noted. All clocks are epoch ms on the same Mac: JS's `Date.now()`, native `NSDate`, a page's
`performance.timeOrigin + startTime`.

- **On screen** means the Core Animation transaction carrying the change has committed (a post-commit handler); the
  display shows it at the next refresh, ≤ 1 frame later. A JS step's frame is marked through the UI manager's queue
  (`ACFieldTiming.markFrame`), so it rides the same batch as the commit's view updates.
- **Engine steps** come from `ArdiaWebView`: `request` (we asked the engine to load), `start` (Chrome's loading
  began), `commit` (`tabDidCommitDocument:`), `fcp` (the page's first-contentful-paint entry, Chrome's presentation
  time) and `shown` (a page that was hidden: two `requestAnimationFrame`s after it became visible, as native-bench's
  tab switch).
- Nothing runs between the action and its result but a few timestamps: marks are drained, and journeys settled, on a
  1 s timer while any is in flight.
- A journey counts only when a key or click came within 1 s before the change (a switch made by closing a tab, an
  extension or a restore isn't the user's).

| Journey | Step | From → to |
|---|---|---|
| J1 launch (`perf_launch`, one per launch) | `js_ms` | process start → the bundle's first module runs (`state/telemetry/jsStart.ts`) |
| | `commit_ms` | → the first window's first React commit |
| | `launch_ms` | → the first window's root effect (**unchanged** since 0.2.x, so old data stays comparable) |
| | `content_ms` | → that first commit on screen |
| | `usable_ms` | → the app answers at once: the first timer after the first commit that runs within 50 ms of being set (both the main and JS threads free), and not before `content_ms` |
| | `tab_request_ms`, `tab_commit_ms`, `tab_paint_ms` | → the restored active tab's load asked for, committed, first contentful paint |
| J2 new tab (`perf_journeys`) | `j2_js` | ⌘T (or the New Tab button) → JS has the new tab |
| | `j2_commit` | → the new tab's command bar committed |
| | `j2_shown` | → that commit on screen |
| | `j2_typeable` | → its field focused, on screen (**the J2 total**) |
| | `j2_suggest` | the bar's first keystroke → its suggestions on screen (not from ⌘T) |
| J3 tab switch | `j3_js` | click or shortcut → JS switched the store |
| | `j3_frame` | → the switch's React commit on screen |
| | `j3_view` | → the page's view shown (same commit as `j3_frame` for a loaded page) |
| | `j3_page` | → a page that was hidden: its first new frame |
| | `j3_total` | the end that applies (**the J3 total**): cold → `j3_page`, warm → `j3_view`, load → its first contentful paint, other → `j3_frame` |
| J4 navigate | `j4_request` | Enter (or a click on a suggestion) → the engine asked to load: **our side** |
| | `j4_start` | → Chrome started the navigation |
| | `j4_commit` | → the new document committed |
| | `j4_fcp` | → first contentful paint (**the J4 total**) |
| | `j4_engine` | `request` → first contentful paint: **the engine's and the network's side** |

Each `perf_journeys` step goes as `<step>_p50`, `_p75`, `_p95`, `_max` and `_n` (ms; at most 500 samples per step per
summary). Counts: `j3_cold` (the page was hidden), `j3_warm` (it was still painting), `j3_load` (it had to load),
`j3_other` (no page: New Tab), `j2_no_bar`, `j4_no_load` (not a page load: a ardia: page, a download),
`j4_no_paint` (nothing painted within 30 s), `j4_replaced` (another navigation came first).
`perf_journeys` goes hourly and at quit, like `perf_omnibox`; `perf_launch` once its steps are in (≤ 30 s after the first
window, or at quit), not at the first window as before.

`perf_launch` context: `tabs` (the restored tabs, an exact count since 0.2.42; before, ranges 0, 1, 2-5, 6-20, 21-50,
51-100, 101-200, 200+, which a numeric query reads as 0), `windows`
(1…10), `history` (0, <100, <1k, <5k, <20k, 20k+ entries), `cold` (the first launch since the Mac started, by
`kern.boottime` against this copy's last launch; null until a second launch with sharing on), `first_of_version` (the
first launch after the app's version or build changed, or the first this copy recorded: macOS's Gatekeeper scans the new
bundle before `main`, so these launches are slower; a copy from before this field compares versions only),
`update_prewarm` (on a first launch of a version: `done` when the previous copy ran this build hidden before installing it,
`failed` when that run was stopped, didn't finish, failed to start, or was refused because the staged copy isn't signed like the running app, `none` when nothing ran; null otherwise) and `update_prewarm_ago` (how long
before this launch that run ended, in `since_quit`'s ranges), `since_quit` (<1m, <10m,
<1h, <8h, <1d, <7d, 7d+, `unclean` when the last session didn't end, `unknown`), `since_boot` (<2m, <10m, <1h, <1d, 1d+).

### A session's payload

A Debug build with Metro (so slower than a release), in a hidden instance, with every journey driven by posted key
events (`expo.modules.ArdiaDev.devPostKey`): ⌘1–4 between four restored tabs, ⌘T and an address typed into the
new tab's bar, Enter, and ⌘L, an address, Enter. The `$`-context properties are left out.

```json
{ "event": "perf_launch", "launch_ms": 1638, "js_ms": 1227, "commit_ms": 1589, "content_ms": 1683, "usable_ms": 1683,
  "tab_request_ms": 1759, "tab_commit_ms": 1846, "tab_paint_ms": 1916,
  "tabs": 3, "windows": 1, "history": "<100", "cold": true, "first_of_version": false, "update_prewarm": null, "update_prewarm_ago": null,
  "since_quit": "<1h", "since_boot": "<1h" }
{ "event": "perf_journeys",
  "j2_js_p50": 4, "j2_commit_p50": 44, "j2_shown_p50": 67, "j2_typeable_p50": 84, "j2_suggest_p50": 62, "j2_typeable_n": 2,
  "j3_js_p50": 4, "j3_frame_p50": 47, "j3_view_p50": 40, "j3_page_p50": 52, "j3_total_p50": 58, "j3_total_p75": 134,
  "j3_total_n": 8, "j3_cold": 5, "j3_load": 3,
  "j4_request_p50": 37, "j4_start_p50": 44, "j4_commit_p50": 76, "j4_fcp_p50": 137, "j4_engine_p50": 100, "j4_fcp_n": 3 }
```

(`perf_journeys` also carries `_p75`, `_p95`, `_max` and `_n` for every step: 75 numbers, about 1.5 KB as OTLP.)

### What isn't exact

- **J2's start** is ⌘T's key down; the keystroke in `j2_suggest` is the key down too. A JS-side keystroke time is used
  only when no key reached the app in the last second.
- **Frames** are Core Animation commits, not photons: up to one refresh more. The engine's own compositor frame after a
  switch isn't visible to the app without an engine change (Chrome's `ContentToVisibleTimeReporter`), so a hidden page's
  end is its second `requestAnimationFrame` (`j3_page`), as in native-bench.
- **A new page's `j4_start`** is when the engine tab came back from `openTab` (its navigation started inside it, before
  the view was its delegate): a few ms late.
- **`usable_ms`** is a responsiveness probe, not a keystroke: React Native's timers tick on display frames, so it has
  ~16 ms granularity.
- **`fcp` is the page's own clock** (its time origin plus the entry's time); a page can't move it but can replace the
  observer before the script installs it: values more than 10 minutes off are dropped natively, outliers past 60 s in JS.
- Builds before this change send `perf_launch` with `launch_ms` only, at the first window.

## Queries (ClickHouse)

Run with `node scripts/telemetry-sql.mjs "<SQL>"` against `telemetry.events` (see `docs/growth.md`, Telemetry).
`properties` is a `Map(String, String)`: numbers go through `toFloat64OrNull`, booleans are `'true'`/`'false'`.
Production only; versions sort numerically. J1 has one value per launch, so its percentiles are exact:

```sql
SELECT properties['$app_version'] AS version, count() AS launches,
  round(quantile(0.5)(toFloat64OrNull(properties['launch_ms']))) AS launch_p50, round(quantile(0.75)(toFloat64OrNull(properties['launch_ms']))) AS launch_p75,
  round(quantile(0.5)(toFloat64OrNull(properties['content_ms']))) AS content_p50, round(quantile(0.75)(toFloat64OrNull(properties['content_ms']))) AS content_p75,
  round(quantile(0.5)(toFloat64OrNull(properties['usable_ms']))) AS usable_p50, round(quantile(0.75)(toFloat64OrNull(properties['usable_ms']))) AS usable_p75,
  round(quantile(0.5)(toFloat64OrNull(properties['tab_paint_ms']))) AS paint_p50, round(quantile(0.75)(toFloat64OrNull(properties['tab_paint_ms']))) AS paint_p75,
  countIf(properties['cold'] = 'true') AS cold_launches
FROM telemetry.events
WHERE timestamp > now() - INTERVAL 30 DAY AND event = 'perf_launch' AND properties['$environment'] = 'production'
GROUP BY version ORDER BY arrayMap(x -> toUInt32OrZero(x), splitByChar('.', version)) DESC
```

Add `AND properties['cold'] = 'true'` (or group by `properties['tabs']`, `properties['history']`) to split cold from
warm launches and small sessions from big ones; that's the field/lab gap's first question.

The first launch of a version against the rest (launch project 3, `launch-critical-path.md`): content on screen and the
restored tab's first paint. Launches from builds before `first_of_version` show it empty.

```sql
SELECT properties['$app_version'] AS version, properties['first_of_version'] AS first_of_version, count() AS launches,
  round(quantile(0.5)(toFloat64OrNull(properties['content_ms']))) AS content_p50, round(quantile(0.75)(toFloat64OrNull(properties['content_ms']))) AS content_p75,
  round(quantile(0.5)(toFloat64OrNull(properties['tab_paint_ms']))) AS paint_p50, round(quantile(0.75)(toFloat64OrNull(properties['tab_paint_ms']))) AS paint_p75
FROM telemetry.events
WHERE timestamp > now() - INTERVAL 30 DAY AND event = 'perf_launch' AND properties['$environment'] = 'production'
GROUP BY version, first_of_version
ORDER BY arrayMap(x -> toUInt32OrZero(x), splitByChar('.', version)) DESC, first_of_version DESC
```

J2–J4 come as per-summary percentiles. Each summary is weighted back into its samples (half its `n` at its p50, a
quarter at its p75, a fifth at its p95, the rest at its max) and the percentiles are taken over all of them with
`quantileExactWeighted`. That merges summaries with different sample counts fairly; it reads the median and p75
slightly high (each band is placed at its upper edge). The headline steps are `j2_typeable`, `j3_total` and `j4_fcp`;
put any other step in the list (`j4_request` for our side of J4, `j4_engine` for the engine's):

```sql
SELECT version, step, sum(w) AS samples,
  round(quantileExactWeighted(0.5)(ms, w)) AS p50, round(quantileExactWeighted(0.75)(ms, w)) AS p75
FROM (
  SELECT properties['$app_version'] AS version, step,
    arrayJoin([('p50', 0.5), ('p75', 0.25), ('p95', 0.2), ('max', 0.05)]) AS band,
    toFloat64OrNull(properties[concat(step, '_', band.1)]) AS ms,
    toUInt64(ceil(toFloat64OrZero(properties[concat(step, '_n')]) * band.2)) AS w
  FROM telemetry.events
  ARRAY JOIN ['j2_typeable', 'j3_total', 'j4_fcp'] AS step
  WHERE timestamp > now() - INTERVAL 30 DAY AND event = 'perf_journeys' AND properties['$environment'] = 'production'
)
WHERE w > 0 AND ms IS NOT NULL
GROUP BY version, step ORDER BY arrayMap(x -> toUInt32OrZero(x), splitByChar('.', version)) DESC, step
```

Checked on 2026-10-14 against the same spread done with `arrayWithConstant` (`samples` and p50 equal for every
version). The earlier version of this query padded with `arrayResize`, which fills with NULL rather than repeating
the value, so it weighted each summary's four bands equally and read high; don't reuse it.
