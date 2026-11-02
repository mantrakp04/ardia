---
name: stats
description: Ardia's numbers in one short report — users and installs, site traffic and downloads, the phone Send to my Mac panel, GitHub, and new errors. Use whenever the owner asks how things are going, "what are the stats", "how many users/downloads/installs", "how many updated", "how's the site doing", GitHub stats, or a growth check-in, even if they don't say "stats".
---

# Ardia stats

The owner wants the numbers fast: one command, then the reply. Don't read other files first.

```sh
node scripts/stats.mjs                      # last 24 h
node scripts/stats.mjs --since "8:30pm IST" # or 6h, 2d, 1w, "21:00 UTC", "2026-10-14 15:00"
```

It takes about a second and prints the finished report: users and installs (daily, weekly and monthly active
copies and new installs from the app's anonymous daily count, with the copies on older versions that don't
send it estimated from update checks and the share the count covers), the site, phones, GitHub,
errors (real ones apart from known noise), and what changed since the last run. Relay it as it is, trimmed
to what was asked, and add a line only for what needs the owner. When they ask for a visual (chart, graph,
"show me"), call `html_render` with the `html` and `height` from the report's last line; it's an SVG the
script already drew, so don't build a page. Without a window in the question, use the default.

Only go further when the report doesn't answer the question:
- an error listed under **Errors** that isn't noise: find the cause and fix it (AGENTS.md);
- a number the report doesn't have: `node scripts/telemetry-sql.mjs "<query>; <query>"` (all in one call),
  with the queries in [queries.md](queries.md) and the event meanings in `docs/growth.md` ("Telemetry");
- installs per version and per day: `node scripts/update-checks.mjs`;
- DAU/WAU/MAU trends or splits by version, channel, macOS or chip: the `daily_active` queries in
  [queries.md](queries.md). WAU and MAU are calendar week (ISO, Monday) and calendar month, in UTC, not rolling.

If `~/.config/ardia/telemetry.env` is missing, the report says so; ask the owner for it.

Copies on 0.2.17 or earlier send their opt-in events to PostHog Cloud, which nothing reads; the report
names those versions when they still check for updates.

Add a dated entry to the Log in `docs/growth.md` only for something worth remembering (a launch, a release's
first day, a spike, a fix), after replying, and commit it.
