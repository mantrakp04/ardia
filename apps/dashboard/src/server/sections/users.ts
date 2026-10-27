import { DATA_START_MS, windowFor, type RangeKey } from "../../lib/range";
import { compareVersions, DAILY_COUNT_SINCE, DAILY_COUNT_START_MS, isNightly, sendsDailyCount } from "../../lib/versions";
import { num, query, str } from "../clickhouse";
import { github, type Release } from "../github";
import { APP, ARDIA_VERSION, DAILY, FIRST, bucket, compareStart, dayBucket, isCurrent, isPrevious, prop, since } from "../sql";
import { dayBuckets, fill, floorDay, windowInfo } from "../series";

const DAY = 86_400_000;
const TOP_VERSIONS = 5;
const MIN_CHART_DAYS = 7;

export type DailyRow = { day: number; dim: string; key: string; count: number; first: number; weekly: number; monthly: number };
export type CheckRow = { day: number; version: string; checks: number; first: number };

export async function dailyRows(signal?: AbortSignal): Promise<DailyRow[]> {
  const rows = await query(
    `SELECT ${dayBucket} AS d, pair.1 AS dim, pair.2 AS key, count(), countIf(properties['first'] = 'true'), countIf(properties['weekly'] = 'true'), countIf(properties['monthly'] = 'true')
     FROM telemetry.events
     ARRAY JOIN [('all', ''), ('version', ${prop("$app_version")}), ('channel', properties['channel']), ('os', properties['os_major']), ('arch', properties['arch'])] AS pair
     WHERE ${DAILY} AND ${since(DAILY_COUNT_START_MS)}
     GROUP BY d, dim, key`,
    signal,
  );
  return rows.map((r) => ({ day: num(r[0]), dim: str(r[1]), key: str(r[2]), count: num(r[3]), first: num(r[4]), weekly: num(r[5]), monthly: num(r[6]) }));
}

export async function checkRows(signal?: AbortSignal): Promise<CheckRow[]> {
  const rows = await query(
    `SELECT ${dayBucket} AS d, ${prop("version")} AS v, count(), countIf(${FIRST})
     FROM telemetry.events
     WHERE event = 'update_check' AND ${since(DATA_START_MS)} AND ${ARDIA_VERSION}
     GROUP BY d, v`,
    signal,
  );
  return rows.map((r) => ({ day: num(r[0]), version: str(r[1]), checks: num(r[2]), first: num(r[3]) }));
}

export type DayCount = {
  day: number;
  dau: number;
  nightly: number;
  newInstalls: number;
  weekly: number;
  monthly: number;
  firstLaunches: number;
  checks: number;
  silentLow: number;
  silentHigh: number;
};

export function countByDay(daily: DailyRow[], checks: CheckRow[], end: number): DayCount[] {
  const days = dayBuckets(DATA_START_MS, end);
  const out = new Map(days.map((day) => [day, { day, dau: 0, nightly: 0, newInstalls: 0, weekly: 0, monthly: 0, firstLaunches: 0, checks: 0, silentLow: 0, silentHigh: 0 }]));
  for (const r of daily) {
    const d = out.get(r.day);
    if (!d) continue;
    if (r.dim === "all") {
      d.dau += r.count;
      d.newInstalls += r.first;
      d.weekly += r.weekly;
      d.monthly += r.monthly;
    } else if (r.dim === "channel" && r.key === "nightly") d.nightly += r.count;
  }
  for (const r of checks) {
    const d = out.get(r.day);
    if (!d) continue;
    d.firstLaunches += r.first;
    d.checks += r.checks;
    if (r.day < DAILY_COUNT_START_MS || !sendsDailyCount(r.version)) {
      d.silentLow += Math.ceil(r.checks / 3);
      d.silentHigh += r.checks;
    }
  }
  return days.map((day) => out.get(day)!);
}

export type Coverage = { day: number; dau: number; silentLow: number; silentHigh: number; totalLow: number; totalHigh: number; coverageLow: number; coverageHigh: number };

export function coverageOf(d: DayCount): Coverage {
  const totalLow = d.dau + d.silentLow;
  const totalHigh = d.dau + d.silentHigh;
  return {
    day: d.day,
    dau: d.dau,
    silentLow: d.silentLow,
    silentHigh: d.silentHigh,
    totalLow,
    totalHigh,
    coverageLow: totalHigh ? d.dau / totalHigh : 0,
    coverageHigh: totalLow ? d.dau / totalLow : 0,
  };
}

const isoMonday = (ms: number) => {
  const day = new Date(ms).getUTCDay();
  return floorDay(ms) - ((day + 6) % 7) * DAY;
};
const monthStart = (ms: number) => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};

export function activeSummary(byDay: DayCount[], end: number) {
  const today = floorDay(end);
  const yesterday = byDay.find((d) => d.day === today - DAY) ?? null;
  const current = byDay.find((d) => d.day === today) ?? null;
  const week = isoMonday(end);
  const month = monthStart(end);
  const sum = (from: number, to: number, f: (d: DayCount) => number) => byDay.filter((d) => d.day >= from && d.day < to).reduce((s, d) => s + f(d), 0);
  return {
    yesterday: yesterday ? coverageOf(yesterday) : null,
    today: current ? { dau: current.dau, newInstalls: current.newInstalls } : null,
    wau: { value: sum(week, end + 1, (d) => d.weekly), previous: sum(week - 7 * DAY, week, (d) => d.weekly), since: week },
    mau: { value: sum(month, end + 1, (d) => d.monthly), since: month },
    nightlyShare: yesterday && yesterday.dau ? yesterday.nightly / yesterday.dau : null,
  };
}

export async function usersActive(range: RangeKey, signal?: AbortSignal) {
  const w = windowFor(range);
  const [daily, checks] = await Promise.all([dailyRows(signal), checkRows(signal)]);
  const byDay = countByDay(daily, checks, w.end);
  const chartStart = floorDay(w.step === "hour" ? Math.min(w.start, w.end - (MIN_CHART_DAYS - 1) * DAY) : w.start);
  const shown = byDay.filter((d) => d.day >= chartStart);
  const windowDay = floorDay(w.start);
  const prevDay = w.prevStart === null ? null : floorDay(w.prevStart);
  const inRange = (f: (d: DayCount) => number) => byDay.filter((d) => d.day >= windowDay).reduce((s, d) => s + f(d), 0);
  const inPrevious = (f: (d: DayCount) => number) =>
    prevDay === null ? null : byDay.filter((d) => d.day >= prevDay && d.day < windowDay).reduce((s, d) => s + f(d), 0);
  const summary = activeSummary(byDay, w.end);
  const latestDay = summary.yesterday?.day ?? null;
  const split = (dim: string) =>
    daily
      .filter((r) => r.dim === dim && r.day === latestDay)
      .map((r) => ({ key: r.key || "unknown", label: r.key || "Unknown", value: r.count }))
      .sort((a, b) => b.value - a.value);
  return {
    window: windowInfo(w),
    dailySince: DAILY_COUNT_SINCE,
    dailyStart: DAILY_COUNT_START_MS,
    days: shown.map((d) => d.day),
    measured: shown.map((d) => (d.day >= DAILY_COUNT_START_MS ? d.dau : null)),
    totalLow: shown.map((d) => d.dau + d.silentLow),
    totalHigh: shown.map((d) => d.dau + d.silentHigh),
    coverage: shown.map((d) => (d.day >= DAILY_COUNT_START_MS ? coverageOf(d) : null)),
    newInstalls: shown.map((d) => (d.day >= DAILY_COUNT_START_MS ? d.newInstalls : null)),
    firstLaunches: shown.map((d) => d.firstLaunches),
    ...summary,
    installs: {
      newInstalls: { value: inRange((d) => d.newInstalls), previous: inPrevious((d) => d.newInstalls) },
      firstLaunches: { value: inRange((d) => d.firstLaunches), previous: inPrevious((d) => d.firstLaunches) },
      comparable: prevDay !== null && prevDay >= DAILY_COUNT_START_MS,
    },
    splits: {
      day: latestDay,
      version: split("version").map((r) => ({ ...r, nightly: isNightly(r.key) })),
      channel: split("channel").map((r) => ({ ...r, label: r.key === "nightly" ? "Nightly" : r.key === "stable" ? "Stable" : r.label })),
      os: split("os").map((r) => ({ ...r, label: r.key === "unknown" ? "Unknown" : `macOS ${r.key}` })),
      arch: split("arch").map((r) => ({ ...r, label: r.key === "arm64" ? "Apple silicon" : r.key === "x86_64" ? "Intel" : r.label })),
    },
  };
}

export async function usersVersions(range: RangeKey, signal?: AbortSignal) {
  const w = windowFor(range);
  const [checks, daily, gh] = await Promise.all([
    checkRows(signal),
    dailyRows(signal),
    github().catch((error: unknown) => ({ error: String((error as Error).message ?? error), releases: [] as Release[] })),
  ]);
  const today = floorDay(w.end);
  const chartStart = floorDay(w.step === "hour" ? Math.min(w.start, w.end - (MIN_CHART_DAYS - 1) * DAY) : w.start);
  const days = dayBuckets(chartStart, w.end);
  const index = new Map(days.map((d, i) => [d, i]));
  const releases = gh.releases.filter((r) => r.tag !== "nightly" && r.published);
  const releaseByVersion = new Map(releases.map((r) => [r.version, r]));

  const inChart = checks.filter((r) => index.has(r.day));
  const byVersionInChart = new Map<string, number>();
  for (const r of inChart) byVersionInChart.set(r.version, (byVersionInChart.get(r.version) ?? 0) + r.checks);
  const top = [...byVersionInChart]
    .filter(([v]) => !isNightly(v))
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_VERSIONS)
    .map(([v]) => v)
    .sort(compareVersions)
    .reverse();
  const keys = [...top, "nightly", "older"];
  const totals = days.map(() => 0);
  const groups = new Map(keys.map((k) => [k, days.map(() => 0)]));
  for (const r of inChart) {
    const i = index.get(r.day)!;
    const key = isNightly(r.version) ? "nightly" : top.includes(r.version) ? r.version : "older";
    groups.get(key)![i]! += r.checks;
    totals[i]! += r.checks;
  }

  const channelTotal = new Map<string, number>();
  const checksOn = new Map<string, number>();
  for (const r of checks) {
    const channelKey = `${r.day}|${isNightly(r.version) ? "n" : "s"}`;
    channelTotal.set(channelKey, (channelTotal.get(channelKey) ?? 0) + r.checks);
    checksOn.set(`${r.day}|${r.version}`, r.checks);
  }
  const allVersions = [...new Set([...checks.map((r) => r.version), ...releases.map((r) => r.version)])];
  const shareAtOrAbove = (version: string, day: number) => {
    if (day >= today) return null;
    const nightly = isNightly(version);
    const total = channelTotal.get(`${day}|${nightly ? "n" : "s"}`) ?? 0;
    if (!total) return null;
    let on = 0;
    for (const v of allVersions) if (isNightly(v) === nightly && compareVersions(v, version) >= 0) on += checksOn.get(`${day}|${v}`) ?? 0;
    return on / total;
  };

  const perVersion = new Map<string, { first: number; checks: number; lastSeen: number; yesterday: number }>();
  for (const r of checks) {
    const v = perVersion.get(r.version) ?? { first: 0, checks: 0, lastSeen: 0, yesterday: 0 };
    v.first += r.first;
    v.checks += r.checks;
    v.lastSeen = Math.max(v.lastSeen, r.day);
    if (r.day === today - DAY) v.yesterday += r.checks;
    perVersion.set(r.version, v);
  }
  const countedYesterday = new Map(daily.filter((r) => r.dim === "version" && r.day === today - DAY).map((r) => [r.key, r.count]));
  const versions = allVersions
    .map((version) => {
      const v = perVersion.get(version) ?? { first: 0, checks: 0, lastSeen: 0, yesterday: 0 };
      const release = releaseByVersion.get(version);
      const day0 = release ? floorDay(Date.parse(release.published)) : null;
      return {
        version,
        nightly: isNightly(version),
        published: release?.published ?? null,
        dmg: release ? release.dmg : null,
        zip: release ? release.zip : null,
        first: v.first,
        lastSeen: v.lastSeen,
        checksYesterday: v.yesterday,
        countedYesterday: countedYesterday.get(version) ?? (sendsDailyCount(version) ? 0 : null),
        adoption: day0 === null || day0 < DATA_START_MS ? null : [1, 3, 7].map((k) => shareAtOrAbove(version, day0 + k * DAY)),
      };
    })
    .filter((v) => v.first > 0 || v.checksYesterday > 0 || v.published)
    .sort((a, b) => compareVersions(b.version, a.version));

  const counted = versions.filter((v) => !v.nightly && compareVersions(v.version, "0.2.14") >= 0);
  const nightlyRelease = gh.releases.find((r) => r.tag === "nightly");
  return {
    days,
    adoption: keys.map((key) => ({
      key,
      label: key === "nightly" ? "Nightlies" : key === "older" ? "Older" : key,
      values: groups.get(key)!.map((n, i) => (totals[i] ? n / totals[i]! : 0)),
    })),
    markers: releases
      .filter((r) => !r.prerelease)
      .map((r) => ({ at: floorDay(Date.parse(r.published)), label: r.version }))
      .filter((m) => index.has(m.at)),
    versions,
    allTime: { dmg: counted.reduce((s, v) => s + (v.dmg ?? 0), 0), first: counted.reduce((s, v) => s + v.first, 0) },
    nightlyRelease: nightlyRelease ? { dmg: nightlyRelease.dmg, zip: nightlyRelease.zip } : null,
    githubError: "error" in gh ? (gh.error as string | null) : null,
  };
}

export async function usersOptedIn(range: RangeKey, signal?: AbortSignal) {
  const w = windowFor(range);
  const rows = await query(
    `SELECT ${bucket(w.step)} AS b, uniq(distinct_id), uniqIf(distinct_id, ${isCurrent(w)}), uniqIf(distinct_id, ${isPrevious(w)})
     FROM telemetry.events
     WHERE ${APP} AND ${since(compareStart(w))}
     GROUP BY GROUPING SETS ((b), ())`,
    signal,
  );
  const total = (rows.find((r) => num(r[0]) === 0) ?? []).map(num);
  return {
    window: windowInfo(w),
    value: total[2] ?? 0,
    previous: w.prevStart !== null ? (total[3] ?? 0) : null,
    series: fill(
      w.buckets,
      rows.filter((r) => num(r[0]) !== 0),
      1,
    ),
  };
}

const NAMES: Record<string, string> = {
  suggestion_chosen: "Omnibox suggestion chosen",
  perf_memory: "Memory sample",
  settings_section_opened: "Settings section opened",
  command_bar_opened: "Command bar opened",
  usage_counts: "Usage counts",
  perf_journeys: "Journey timings",
  perf_omnibox: "Omnibox timings",
  profile_switched: "Profile switched",
  perf_launch: "Launch timings",
  app_launched: "App launched",
  app_session_ended: "Session ended",
  app_updated: "App updated",
  sharing_turned_on: "Telemetry turned on",
  split_view_opened: "Split view opened",
  translate_used: "Translate used",
  sync_toggled: "Sync toggled",
  extension_installed: "Extension installed",
};

export async function usersUsage(range: RangeKey, signal?: AbortSignal) {
  const w = windowFor(range);
  const minutes = "toFloat64OrZero(properties['duration_minutes'])";
  const rows = await query(
    `SELECT dim, key, uniq(distinct_id) AS people, count() AS n, max(toUnixTimestamp64Milli(timestamp))
     FROM (
       SELECT distinct_id, timestamp,
         arrayJoin(arrayConcat(
           [('event', event)],
           multiIf(
             event = 'settings_section_opened', [('section', properties['section'])],
             event = 'suggestion_chosen', [('suggestion', properties['type'])],
             event = 'app_updated', [('update', concat(properties['from_version'], ' → ', ${prop("$app_version")}))],
             event = 'app_session_ended', [('session', multiIf(${minutes} < 5, '0|< 5 min', ${minutes} < 30, '1|5–30 min', ${minutes} < 120, '2|30 min–2 h', ${minutes} < 480, '3|2–8 h', '4|8 h +'))],
             []
           )
         )) AS pair,
         pair.1 AS dim, pair.2 AS key
       FROM telemetry.events
       WHERE ${APP} AND ${since(w.start)}
     )
     GROUP BY dim, key
     ORDER BY dim, n DESC
     LIMIT 30 BY dim`,
    signal,
  );
  const of = (dim: string) =>
    rows.filter((r) => str(r[0]) === dim).map((r) => ({ key: str(r[1]) || "unknown", label: str(r[1]) || "Unknown", value: num(r[2]), secondary: num(r[3]), last: num(r[4]) }));
  return {
    sections: of("section"),
    suggestions: of("suggestion"),
    events: of("event").map((r) => ({ key: r.key, label: NAMES[r.key] ?? r.key, count: r.secondary, people: r.value, lastSeen: r.last })),
    updates: of("update").map((r) => {
      const [from = "unknown", to = ""] = r.key.split(" → ");
      return { from: from || "unknown", to, count: r.secondary, people: r.value };
    }),
    sessionLengths: of("session")
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((r) => ({ key: r.key, label: r.key.split("|")[1] ?? r.key, value: r.secondary })),
  };
}
