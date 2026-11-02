import {
  APP_LIBS,
  APP_SOURCES,
  DAILY_LIB,
  HISTORY_SOURCE,
  PRODUCTION_HOSTS,
  SITE_EVENTS,
  SITE_LIBS,
  SITE_SOURCES,
  visitorOnSql,
  type SiteEvent,
} from "../../../site/src/data/telemetry";
import type { Step, Window } from "../lib/range";

const TYPED_COLUMNS_LIVE = true;

const TYPED_COLUMNS: Record<string, string> = {
  $lib: "lib",
  $host: "host",
  $os: "os",
  $device_type: "device_type",
  $browser: "browser",
  $app_version: "app_version",
  version: "version",
  $pathname: "pathname",
  $referring_domain: "referring_domain",
  $geoip_country_code: "country",
};

export const prop = (key: string) => (TYPED_COLUMNS_LIVE && TYPED_COLUMNS[key] ? TYPED_COLUMNS[key] : `properties['${key}']`);

const sqlList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");

export const SITE = `(source IN (${sqlList([...SITE_SOURCES, HISTORY_SOURCE])}) AND ${prop("$lib")} IN (${sqlList(SITE_LIBS)}) AND ${prop("$host")} IN (${sqlList(PRODUCTION_HOSTS)}))`;
export const APP_SOURCE = `(source IN (${sqlList([...APP_SOURCES, HISTORY_SOURCE])}) AND ${prop("$lib")} IN (${sqlList(APP_LIBS)}))`;
export const APP_EVENTS = [
  "app_launched",
  "app_session_ended",
  "app_updated",
  "command_bar_opened",
  "extension_installed",
  "perf_journeys",
  "perf_launch",
  "perf_memory",
  "perf_omnibox",
  "profile_switched",
  "settings_section_opened",
  "sharing_turned_on",
  "split_view_opened",
  "suggestion_chosen",
  "sync_toggled",
  "translate_used",
  "usage_counts",
];
export const APP = `(event IN (${sqlList(APP_EVENTS)}) AND ${APP_SOURCE})`;
export const MAC = `(${visitorOnSql("mac", prop)})`;
export const PHONE = `(${visitorOnSql("phone", prop)})`;
export const ARDIA_VERSION = `match(${prop("version")}, '^0\\\\.[0-9]+\\\\.[0-9]+(-nightly\\\\.[0-9]+)?$')`;
export const NIGHTLY = `position(${prop("version")}, '-nightly') > 0`;
export const FIRST = `properties['first'] = 'true'`;

export const at = (ms: number) => `toDateTime64(${(ms / 1000).toFixed(3)}, 3, 'UTC')`;

export const since = (ms: number) => `timestamp >= ${at(ms)}`;
export const compareStart = (w: Window) => w.prevStart ?? w.start;
export const isCurrent = (w: Window) => `(timestamp >= ${at(w.start)})`;
export const isPrevious = (w: Window) =>
  w.prevStart === null ? "0" : `(timestamp >= ${at(w.prevStart)} AND timestamp < ${at(w.start)})`;

export const bucket = (step: Step) =>
  step === "hour" ? "toUnixTimestamp(toStartOfHour(timestamp)) * 1000" : "toUnixTimestamp(toStartOfDay(timestamp)) * 1000";

export const dayBucket = "toUnixTimestamp(toStartOfDay(timestamp)) * 1000";

export const DAILY = `(event = 'daily_active' AND source = '${APP_SOURCES[0]}' AND ${prop("$lib")} = '${DAILY_LIB}' AND properties['$environment'] = 'production')`;
export const ACTIVITY_EVENTS = "'app_launched', 'perf_memory', 'usage_counts'";

const NOT_A_CLICK: readonly SiteEvent[] = ["section_viewed", "mac_link_visit", "non_mac_visit"];
export const CLICK_SITE_EVENTS = sqlList(SITE_EVENTS.filter((e) => !NOT_A_CLICK.includes(e)));
