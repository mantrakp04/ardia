# Dashboard: Settings

`/settings` in the dashboard (`apps/dashboard`) shows which settings opted-in users change, from the app's `settings_snapshot` event. The app sends it from 0.2.43-nightly.8, only with "Share anonymous crash reports and usage stats" on, at most once per UTC day per install.

## The event

`settings_snapshot` goes through the normal telemetry client, so it lands in `telemetry.events` with `source` `ardia-app`, `lib` `ardia-telemetry`, `distinct_id` = the install id and `app_version` = the build. For every allowlisted boolean, enum and number setting it carries:

- `setting_<key>`: the current value (`"true"`/`"false"`, the enum string, or the number as ClickHouse renders a double, e.g. `"0.8"`, `"1"`);
- `default_<key>`: that build's default, same encoding.

`<key>` keeps the app's camelCase (`setting_glassTintAmount`). A null value arrives empty, absent or as `"null"`; the dashboard folds all three into `null` (shown as "not set"). Text settings are never sent. The key list is never hard-coded: it is every `setting_`/`default_` suffix seen in the range.

## What the page computes

- **Every setting.** Per key, from each install's latest snapshot in the range: installs reporting it, the share on default (value equals that install's own build default), the most common non-default value, and the share on default per UTC day. The Default column is the newest app version's default. A key whose default differs between two versions in the range gets a "default changed in X" badge.
- **Detail** (`/settings?setting=<key>`): each day's value shares (top five values plus Other, default in green), and a by-version table built from each install's latest snapshot on that version, so a release that flips a default shows up as its own row.
- **Theme tint amount.** Installs whose latest snapshot has `setting_glassTintWithTheme = "true"`: the `glassTintAmount` histogram in 0.1 buckets (1.0 counts in the last), median, mean, install count, and the median per ISO week (latest snapshot per install per week).

Server code: `apps/dashboard/src/server/sections/settings.ts` (`settingsSql` builds the three queries). Sections `settings` and `settings.tint`.

## Checking the SQL locally

Nothing reads production for this. Run a throwaway `clickhouse server` with a `telemetry.events` MergeTree table that has the view's columns (`event`, `distinct_id`, `timestamp`, `properties`, `source`, `lib`, `app_version`, …), insert a few fake installs, then start the dashboard against it:

```
PORT=4417 DASHBOARD_DEV_BYPASS_AUTH=1 CLICKHOUSE_URL=http://127.0.0.1:18123/ CLICKHOUSE_USER=reader CLICKHOUSE_PASSWORD=<fixture> pnpm -C apps/dashboard dev
```

Explicit env vars win over `~/.config/ardia/*.env`, so the dev server never touches the real ClickHouse this way.
