# Stats queries (ClickHouse)

Run with `node scripts/telemetry-sql.mjs "<query>; <query>; …"` (read-only user from `~/.config/ardia/telemetry.env`).
Put every query you need in one call, separated by `;` (or pipe them on stdin): they run 4 at a time and print
in order under `== n` headers. Each request costs about 0.35 s of network on top of the query, so one call with
ten queries takes about as long as two calls with one each. Most queries take 0.1–0.2 s on the server; the
slow ones are those without an `event` filter, which decode every row's `properties` map. Always filter on
`event` (both tables sort by event, then date), and add a `timestamp >` filter when only recent events
matter: that skips the September history entirely.
`scripts/stats.mjs` already prints the whole report; these are for what it doesn't cover.
Everything is in `telemetry.events`: PostHog's event and property naming (`$pageview`, `$lib`…), one row per event, `properties`
a `Map(String, String)` (booleans are `'true'`/`'false'`). `source` says who sent it: `ardia-site`,
`ardia-app`, `ardia-feed` (update checks; `netnyahoo-site`, `-app` and `-feed` before the rename) or `posthog-cloud`
(history only: events from 2026-09-29 09:04 to 2026-09-30 14:31 UTC, before our own pipeline; nothing new
arrives with it). Times are UTC.

Common filters. They are not SQL macros: paste the expression in place of the name.

```sql
-- the site, production only (the history has localhost too)
SITE  = (source IN ('ardia-site', 'netnyahoo-site', 'posthog-cloud') AND properties['$lib'] IN ('web', 'ardia-web', 'netnyahoo-web')
         AND properties['$host'] IN ('ardia.dev', 'www.ardia.dev', 'netnyahoo.com', 'www.netnyahoo.com'))
-- the Mac app's always-on anonymous daily count (one row per copy per UTC day, a fresh random distinct_id each time)
DAILY = (event = 'daily_active' AND source = 'ardia-app' AND properties['$lib'] = 'ardia-daily' AND properties['$environment'] = 'production')
-- the Mac app's opted-in telemetry
APP   = (source IN ('ardia-app', 'netnyahoo-app', 'posthog-cloud') AND properties['$lib'] IN ('ardia-telemetry', 'netnyahoo-telemetry'))
MAC   = (properties['$os'] = 'Mac OS X' AND properties['$device_type'] = 'Desktop')
PHONE = (properties['$device_type'] IN ('Mobile', 'Tablet'))
```

## Site

```sql
-- Visitors: all time, last 24 h, last 6 h
SELECT uniqExact(distinct_id), uniqExactIf(distinct_id, timestamp > now() - INTERVAL 24 HOUR),
       uniqExactIf(distinct_id, timestamp > now() - INTERVAL 6 HOUR)
FROM telemetry.events WHERE event = '$pageview' AND SITE;

-- Visitors per hour (trend), last 24 h
SELECT toStartOfHour(timestamp) AS hour, uniqExact(distinct_id)
FROM telemetry.events WHERE event = '$pageview' AND SITE AND timestamp > now() - INTERVAL 24 HOUR
GROUP BY hour ORDER BY hour;

-- Where they come from (last 6 h)
SELECT properties['$referring_domain'] AS ref, uniqExact(distinct_id) AS visitors
FROM telemetry.events WHERE event = '$pageview' AND SITE AND timestamp > now() - INTERVAL 6 HOUR
GROUP BY ref ORDER BY visitors DESC LIMIT 10;

-- Device mix (share of phones), last 24 h
SELECT properties['$device_type'] AS device, properties['$os'] AS os, uniqExact(distinct_id)
FROM telemetry.events WHERE event = '$pageview' AND SITE AND timestamp > now() - INTERVAL 24 HOUR
GROUP BY device, os ORDER BY 3 DESC;

-- Download clickers, all time and Mac
SELECT uniqExact(distinct_id), uniqExactIf(distinct_id, MAC)
FROM telemetry.events WHERE event = 'download_clicked' AND SITE;

-- Mac download rate since T: Mac desktop visitors who clicked Download / Mac desktop visitors
SELECT uniqExactIf(distinct_id, event = 'download_clicked') AS clicked,
       uniqExactIf(distinct_id, event = '$pageview') AS visitors, round(100 * clicked / visitors, 1) AS pct
FROM telemetry.events WHERE event IN ('$pageview', 'download_clicked') AND SITE AND MAC
  AND timestamp > now() - INTERVAL 24 HOUR;
-- (Windows/Linux: swap MAC for properties['$os'] IN ('Windows') / ('Linux').)

-- Clicks worth watching
SELECT event, count(), uniqExact(distinct_id) FROM telemetry.events
WHERE SITE AND event IN ('github_clicked', 'screenshot_opened', 'notify_clicked', '$rageclick', '$dead_click')
  AND timestamp > now() - INTERVAL 24 HOUR GROUP BY event;

-- Dead clicks by element text (images have none)
SELECT properties['$el_text'] AS text, count() FROM telemetry.events
WHERE SITE AND event = '$dead_click' AND timestamp > now() - INTERVAL 24 HOUR GROUP BY text ORDER BY 2 DESC LIMIT 10;
```

## Phones: Send to my Mac

```sql
-- Panel funnel: taps, then how the link got out (outcome: shared|copied|blocked|failed; fallback: copied|selected|email)
SELECT event, properties['outcome'] AS outcome, properties['action'] AS action, uniqExact(distinct_id)
FROM telemetry.events WHERE SITE AND event IN ('send_to_mac_clicked', 'send_to_mac_fallback')
  AND timestamp > now() - INTERVAL 24 HOUR GROUP BY event, outcome, action ORDER BY event, 4 DESC;

-- Macs that opened a sent link
SELECT uniqExact(distinct_id) FROM telemetry.events WHERE SITE AND event = 'mac_link_visit';
```

## Experiment `download-band`

```sql
-- Exposed Mac visitors per variant, and how many of them clicked Download after exposure
WITH exposures AS (
  SELECT distinct_id, any(properties['$feature_flag_response']) AS variant, min(timestamp) AS exposed_at
  FROM telemetry.events WHERE event = '$feature_flag_called' AND properties['$feature_flag'] = 'download-band' AND SITE
  GROUP BY distinct_id)
SELECT variant, count() AS exposed,
       countIf(distinct_id IN (SELECT distinct_id FROM telemetry.events WHERE event = 'download_clicked' AND SITE)) AS clicked,
       round(100 * clicked / exposed, 1) AS pct
FROM exposures GROUP BY variant;
```

## App and installs

```sql
-- Active users from the daily count. No ID: each copy sends one row per UTC day, flagged `first` (first ever),
-- `weekly` (first in its ISO week) and `monthly` (first in its calendar month), so counting rows gives
-- DAU, and counting flagged rows gives calendar-week WAU, calendar-month MAU and new installs.
SELECT toDate(timestamp) AS day, count() AS dau, countIf(properties['first'] = 'true') AS new_installs
FROM telemetry.events WHERE DAILY AND timestamp > now() - INTERVAL 30 DAY GROUP BY day ORDER BY day;

SELECT toMonday(timestamp) AS week, countIf(properties['weekly'] = 'true') AS wau
FROM telemetry.events WHERE DAILY AND timestamp > now() - INTERVAL 12 WEEK GROUP BY week ORDER BY week;

SELECT toStartOfMonth(timestamp) AS month, countIf(properties['monthly'] = 'true') AS mau
FROM telemetry.events WHERE DAILY GROUP BY month ORDER BY month;

-- Only 0.2.41-nightly.3 and later send it, so until the older versions are gone these count part of the users.
-- The report estimates the rest per day from update_check on older versions (checks ÷ 3 to checks) and prints
-- the coverage; while it rises, a week-over-week or month-over-month change is the rollout, not growth.

-- DAU split by version, channel, macOS or chip (yesterday, a full day)
SELECT properties['$app_version'] AS version, properties['channel'] AS channel, properties['os_major'] AS macos,
       properties['arch'] AS arch, count()
FROM telemetry.events WHERE DAILY AND toDate(timestamp) = yesterday() GROUP BY version, channel, macos, arch ORDER BY 5 DESC;

-- First launches and checks per version (also: node scripts/update-checks.mjs)
SELECT properties['version'] AS v, countIf(properties['first'] = 'true') AS first_launches, count() AS checks
FROM telemetry.events WHERE event = 'update_check' AND match(v, '^[0-9]+\\.[0-9]+\\.[0-9]+$')
GROUP BY v ORDER BY v;

-- Opted-in app users by version, last 7 days
SELECT properties['$app_version'] AS version, uniqExact(distinct_id)
FROM telemetry.events WHERE APP AND timestamp > now() - INTERVAL 7 DAY GROUP BY version ORDER BY 2 DESC;
```

## Errors

```sql
-- New exceptions, site and app (last 24 h), grouped by type and message
SELECT if(APP, 'app', 'site') AS where, properties['$exception_types'] AS type,
       substring(properties['$exception_values'], 1, 120) AS message, properties['$app_version'] AS app_version,
       count(), uniqExact(distinct_id), max(timestamp)
FROM telemetry.events WHERE event = '$exception' AND (SITE OR APP) AND timestamp > now() - INTERVAL 24 HOUR
GROUP BY where, type, message, app_version ORDER BY 5 DESC LIMIT 30;
-- The stack is in properties['$exception_list'] (JSON). Plain warnings/errors (not events): telemetry.logs.
```

## Replays

`node scripts/replay.mjs --list` lists recorded sessions (`telemetry.replay_sessions`); `node scripts/replay.mjs <session>`
plays one locally. Find the session of an event with `session_id` on `telemetry.events`.
