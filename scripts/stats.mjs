#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { clickhouse, hasTelemetryEnv } from "./telemetry-env.mjs";

const USAGE = `usage: node scripts/stats.mjs [--since <when>] [--json] [--no-save]

Ardia's numbers in one report: users and installs, the site, phones, GitHub and errors, for a window
ending now, plus what changed since the last run. Writes the visual as an SVG and prints its path.

  --since <when>   start of the window (default 24h): 6h, 90m, 2d, 1w, "8:30pm IST", "20:30",
                   "21:00 UTC", "2026-10-14 15:00" (local time unless it ends in UTC or Z)
  --json           print the data as JSON instead of the report
  --no-save        don't record this run as the last check`;

const REPO = "mantrakp04/ardia";
const STATE = join(homedir(), ".local/state/ardia/stats-last.json");
const TRAFFIC_CACHE = join(homedir(), ".cache/ardia/github-traffic.json");
const RELEASES_CACHE = join(homedir(), ".cache/ardia/github-older-releases.json");
const SVG_DIR = "/tmp/ardia-stats";
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  console.log(USAGE);
  process.exit(0);
}
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

function parseSince(text, now) {
  if (!text) return now - 24 * 3600e3;
  const s = text.trim().toLowerCase();
  let m = /^(\d+(?:\.\d+)?)\s*(m|min|mins|h|hr|hrs|d|day|days|w)$/.exec(s);
  if (m) {
    const unit = { m: 60e3, min: 60e3, mins: 60e3, h: 3600e3, hr: 3600e3, hrs: 3600e3, d: 864e5, day: 864e5, days: 864e5, w: 6048e5 }[m[2]];
    return now - Number(m[1]) * unit;
  }
  const zoneOffset = (zone) => (zone === "ist" ? 330 : zone === "utc" || zone === "z" ? 0 : null);
  m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(ist|utc|z)?$/.exec(s);
  if (m) {
    let hour = Number(m[1]) % (m[3] ? 12 : 24);
    if (m[3] === "pm") hour += 12;
    const offset = zoneOffset(m[4]) ?? -new Date(now).getTimezoneOffset();
    const shifted = new Date(now + offset * 60e3);
    let at = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), hour, Number(m[2] ?? 0)) - offset * 60e3;
    if (at > now) at -= 864e5;
    return at;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{1,2}):(\d{2}))?\s*(ist|utc|z)?$/.exec(s);
  if (m) {
    const [, y, mo, d, h = "0", mi = "0", zone] = m;
    const offset = zoneOffset(zone);
    if (offset === null) return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)).getTime();
    return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)) - offset * 60e3;
  }
  throw new Error(`can't read --since "${text}"`);
}

const now = Date.now();
const since = parseSince(flag("--since"), now);
const sinceSec = Math.floor(since / 1000);
const span = now - since;
const step = span <= 8 * 3600e3 ? 900 : span <= 3 * 864e5 ? 3600 : 86400;
const zoneOffsetSec = -new Date(now).getTimezoneOffset() * 60;
const origin = Math.floor((sinceSec + zoneOffsetSec) / step) * step - zoneOffsetSec;

const HOSTS = "'ardia.dev', 'www.ardia.dev', 'netnyahoo.com', 'www.netnyahoo.com'";
const SITE = `(source IN ('ardia-site', 'netnyahoo-site', 'posthog-cloud') AND properties['$lib'] IN ('web', 'ardia-web', 'netnyahoo-web') AND properties['$host'] IN (${HOSTS}))`;
const APP = `(source IN ('ardia-app', 'netnyahoo-app', 'posthog-cloud') AND properties['$lib'] IN ('ardia-telemetry', 'netnyahoo-telemetry'))`;
const DAILY = "Event = 'daily_active' AND ServiceName = 'ardia-app' AND LogAttributes['$lib'] = 'ardia-daily' AND LogAttributes['$environment'] = 'production'";
const WINDOW_EVENTS = [
  "$pageview", "download_clicked", "github_clicked", "screenshot_opened", "release_notes_viewed", "notify_clicked",
  "$rageclick", "$dead_click", "send_to_mac_clicked", "send_to_mac_fallback", "mac_link_visit", "$exception",
].map((e) => `'${e}'`).join(", ");

const OTEL = {
  table: "telemetry.otel_logs", final: " FINAL",
  p: "LogAttributes", ts: "Timestamp", t: "toDateTime64(Timestamp, 6, 'UTC')", e: "Event", d: "DistinctId",
  site: `ServiceName IN ('ardia-site', 'netnyahoo-site') AND {p}['$lib'] IN ('web', 'ardia-web', 'netnyahoo-web') AND {p}['$host'] IN (${HOSTS})`,
  app: "ServiceName IN ('ardia-app', 'netnyahoo-app') AND {p}['$lib'] IN ('ardia-telemetry', 'netnyahoo-telemetry')",
  base: "Event != '' AND ResourceAttributes['service.version'] != '0.0.0-selftest'",
};
const HISTORY = {
  table: "telemetry.posthog_events", final: "",
  p: "properties", ts: "timestamp", t: "timestamp", e: "event", d: "distinct_id",
  site: `{p}['$lib'] IN ('web', 'ardia-web', 'netnyahoo-web') AND {p}['$host'] IN (${HOSTS})`,
  app: "{p}['$lib'] IN ('ardia-telemetry', 'netnyahoo-telemetry')",
  base: "1",
};
const fill = (sql, t) =>
  sql.replace(/\{(site|app)\}/g, (_, k) => `(${t[k]})`)
    .replaceAll("{mac}", "({p}['$os'] = 'Mac OS X' AND {p}['$device_type'] = 'Desktop')")
    .replace(/\{(p|ts|t|e|d)\}/g, (_, k) => t[k]);
const both = (select, where, { final = false } = {}) =>
  [OTEL, HISTORY]
    .map((t) => `SELECT ${fill(select, t)} FROM ${t.table}${final ? t.final : ""} WHERE ${fill(where, t)} AND ${t.base}`)
    .join(" UNION ALL ");
const VERSION = "'^[0-9]+\\\\.[0-9]+\\\\.[0-9]+(-nightly\\\\.[0-9]+)?$'";

const problems = [];
const attempt = async (name, fn) => {
  try {
    return await fn();
  } catch (error) {
    problems.push(`${name}: ${String(error.message ?? error).split("\n")[0].slice(0, 200)}`);
    return null;
  }
};

const windowRows = () =>
  clickhouse(`SELECT event, distinct_id, toUnixTimestamp(timestamp), properties['$referring_domain'], properties['$device_type'],
      properties['$os'], properties['$geoip_country_code'], properties['outcome'], properties['action'],
      if(${APP}, 'app', 'site'), properties['$app_version'],
      if(event = '$exception', properties['$exception_values'], ''), if(event = '$exception', substring(properties['$exception_list'], 1, 4000), ''),
      if(event = '$exception', properties['$raw_user_agent'], '')
    FROM telemetry.events
    WHERE event IN (${WINDOW_EVENTS}) AND timestamp >= toDateTime(${sinceSec}, 'UTC')
      AND (${SITE} OR (event = '$exception' AND ${APP}))`);

const headline = () =>
  clickhouse(`SELECT
    (SELECT tuple(uniqExactIf(d, e = '$pageview'), uniqExactIf(d, e = '$pageview' AND t > now() - INTERVAL 24 HOUR),
                  uniqExactIf(d, e = 'download_clicked'), uniqExactIf(d, e = 'download_clicked' AND mac), uniqExactIf(d, e = 'mac_link_visit'))
     FROM (${both("toString({e}) AS e, {d} AS d, {t} AS t, {mac} AS mac", "{e} IN ('$pageview', 'download_clicked', 'mac_link_visit') AND {site}")})),
    (SELECT groupArray(tuple(v, yesterday, today, firstYesterday, firstToday, first)) FROM (
       SELECT v, countIf(day = yesterday()) AS yesterday, countIf(day = today()) AS today,
              countIf(isFirst AND day = yesterday()) AS firstYesterday, countIf(isFirst AND day = today()) AS firstToday,
              countIf(isFirst) AS first
       FROM (${both("{p}['version'] AS v, toDate({t}) AS day, {p}['first'] = 'true' AS isFirst", "{e} = 'update_check'", { final: true })})
       WHERE match(v, ${VERSION}) GROUP BY v)),
    (SELECT tuple(uniqExactIf(d, t >= toDateTime(${sinceSec}, 'UTC')), uniqExactIf(d, t >= today()), uniqExact(d))
     FROM (${both("{d} AS d, {t} AS t", `{ts} > now() - INTERVAL ${Math.max(7, Math.ceil(span / 864e5))} DAY AND {app}`)})),
    (SELECT tuple(countIf(day = today()), countIf(day = yesterday()), countIf(weekly AND day >= toMonday(today())),
                  countIf(weekly AND day >= toMonday(today()) - 7 AND day < toMonday(today())), countIf(monthly AND day >= toStartOfMonth(today())),
                  countIf(isFirst AND day = today()), countIf(isFirst AND day = yesterday()), groupUniqArray(version))
     FROM (SELECT toDate(Timestamp) AS day, LogAttributes['weekly'] = 'true' AS weekly, LogAttributes['monthly'] = 'true' AS monthly,
                  LogAttributes['first'] = 'true' AS isFirst, LogAttributes['$app_version'] AS version
           FROM telemetry.otel_logs FINAL WHERE ${DAILY} AND Timestamp > now() - INTERVAL 40 DAY))`);

const githubQuery = (releases, after) => `{ repository(owner: "mantrakp04", name: "ardia") { stargazerCount forkCount issues(states: OPEN) { totalCount }
  stargazers(last: 100) { edges { starredAt } }
  releases(first: ${releases}${after ? `, after: "${after}"` : ""}, orderBy: { field: CREATED_AT, direction: DESC }) { pageInfo { endCursor }
    nodes { tagName isDraft isPrerelease publishedAt releaseAssets(first: 20) { nodes { name downloadCount } } } } } }`;
const LIVE_RELEASES = 5;
const github = async () => {
  const token = process.env.GH_TOKEN ?? (await promisify(execFile)("gh", ["auth", "token"])).stdout.trim();
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
  const graphql = async (query) => {
    const res = await fetch("https://api.github.com/graphql", { method: "POST", headers, body: JSON.stringify({ query }) });
    const body = await res.json();
    if (!res.ok || body.errors) throw new Error(`GitHub GraphQL: ${res.status} ${JSON.stringify(body.errors ?? body).slice(0, 160)}`);
    return body.data.repository;
  };
  const rest = (path) => fetch(`https://api.github.com/repos/${REPO}/${path}`, { headers }).then((r) => (r.ok ? r.json() : null));
  const cachedFor = async (file, maxAge, load) => {
    const cached = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    if (cached && now - cached.at < maxAge) return cached;
    const fresh = load().then((value) => {
      const entry = { ...value, at: Date.now() };
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(entry));
      return entry;
    });
    if (!cached) return fresh;
    return Promise.race([fresh.catch(() => cached), new Promise((resolve) => setTimeout(resolve, 800, cached))]);
  };
  const repoPromise = graphql(githubQuery(LIVE_RELEASES));
  const [repo, older, { views, referrers }] = await Promise.all([
    repoPromise,
    repoPromise.then((r) =>
      cachedFor(RELEASES_CACHE, 3600e3, async () => ({ after: r.releases.pageInfo.endCursor, nodes: (await graphql(githubQuery(100, r.releases.pageInfo.endCursor))).releases.nodes })),
    ),
    cachedFor(TRAFFIC_CACHE, 3600e3, async () => {
      const [views, referrers] = await Promise.all([rest("traffic/views"), rest("traffic/popular/referrers")]);
      return { views, referrers };
    }),
  ]);
  const liveTags = new Set(repo.releases.nodes.map((r) => r.tagName));
  const releases = { nodes: [...repo.releases.nodes, ...older.nodes.filter((r) => !liveTags.has(r.tagName))] };
  const starTimes = repo.stargazers.edges.map((e) => Date.parse(e.starredAt));
  const count = (release, ext) => release.releaseAssets.nodes.find((a) => a.name.endsWith(ext))?.downloadCount ?? 0;
  const latest = releases.nodes.find((r) => !r.isDraft && !r.isPrerelease);
  return {
    stars: repo.stargazerCount,
    starsInWindow: starTimes.filter((t) => t >= since).length,
    stars24h: starTimes.filter((t) => t >= now - 864e5).length,
    forks: repo.forkCount,
    openIssues: repo.issues.totalCount,
    dmg: releases.nodes.reduce((sum, r) => sum + count(r, ".dmg"), 0),
    zips: releases.nodes.reduce((sum, r) => sum + count(r, ".zip"), 0),
    latest: latest && { version: latest.tagName.replace(/^v/, ""), dmg: count(latest, ".dmg"), zip: count(latest, ".zip"), published: latest.publishedAt },
    views: views && { count: views.count, uniques: views.uniques },
    referrers: (referrers ?? []).slice(0, 3).map((r) => [r.referrer, r.uniques]),
  };
};

const [rows, head, gitHub] = await Promise.all([
  hasTelemetryEnv() ? attempt("telemetry (window)", windowRows) : (problems.push("telemetry: ~/.config/ardia/telemetry.env is missing (docs/growth.md, Telemetry)"), null),
  hasTelemetryEnv() ? attempt("telemetry (headline)", headline) : null,
  attempt("github", github),
]);

const uniq = (list) => new Set(list).size;
const compareVersions = (a, b) => {
  const parse = (v) => {
    const [core = "", pre = ""] = v.split("-nightly.");
    return [...core.split(".").map(Number), pre ? Number(pre) : Number.POSITIVE_INFINITY];
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
};
const tally = (pairs, top = 6) => {
  const sets = new Map();
  for (const [key, id] of pairs) {
    if (!sets.has(key)) sets.set(key, new Set());
    sets.get(key).add(id);
  }
  return [...sets].map(([k, s]) => [k, s.size]).sort((a, b) => b[1] - a[1]).slice(0, top);
};
const deviceName = (type, os) => {
  if (type === "Desktop") return os === "Mac OS X" ? "Mac" : os || "desktop";
  if (os === "iOS") return type === "Tablet" ? "iPad" : "iPhone";
  if (os === "Android") return "Android";
  return os || type || "other";
};
const COUNTRY = new Intl.DisplayNames(["en"], { type: "region" });
const countryName = (code) => {
  try {
    return code ? COUNTRY.of(code) : "unknown";
  } catch {
    return code;
  }
};
const SHORT = { "United States": "US", "United Kingdom": "UK", "United Arab Emirates": "UAE", "Netherlands": "Netherlands" };
const REF = { "$direct": "direct", "t.co": "X (t.co)", "www.google.com": "Google", "": "direct" };

function classifyError({ message, list, ua, where }) {
  if (where === "app") return null;
  const frames = (() => {
    try {
      return JSON.parse(list).flatMap((x) => x.stacktrace?.frames ?? []);
    } catch {
      return [];
    }
  })();
  if (/^Script error\.?$/.test(message)) return "cross-origin Script error.";
  if (frames.some((f) => /^(chrome|moz|safari(-web)?)-extension:/.test(f.filename ?? ""))) return "browser extension";
  if (/webkit\.messageHandlers|Twitter for|Instagram|FBAN|FBAV/.test(message + ua)) return "in-app browser";
  if (/Non-Error promise rejection captured with value: \{\}/.test(message)) return "Safari empty promise rejection (known)";
  if (/ResizeObserver loop/.test(message)) return "ResizeObserver";
  if (/Load failed|Failed to fetch|NetworkError|network error/i.test(message)) return "network drop";
  if (/wallet|ethereum|solana|metamask|LavaMoat/i.test(message)) return "wallet extension";
  return null;
}

const data = { at: now, since, step, tz: TZ, github: gitHub, problems };
if (rows) {
  const r = rows.map(([event, id, t, ref, type, os, country, outcome, action, where, version, values, list, ua]) => ({
    event, id, t: Number(t), ref, type, os, country, outcome, action, where, version, values, list, ua,
  }));
  const views = r.filter((x) => x.event === "$pageview");
  const ofEvent = (e) => r.filter((x) => x.event === e);
  const macViews = views.filter((x) => x.os === "Mac OS X" && x.type === "Desktop");
  const downloads = ofEvent("download_clicked");
  const buckets = Array.from({ length: Math.ceil((now / 1000 - origin) / step) }, () => new Set());
  for (const v of views) buckets[Math.min(buckets.length - 1, Math.floor((v.t - origin) / step))]?.add(v.id);
  const clicks = (e) => ({ count: ofEvent(e).length, people: uniq(ofEvent(e).map((x) => x.id)) });
  const sends = ofEvent("send_to_mac_clicked");
  const errors = new Map();
  for (const x of ofEvent("$exception")) {
    let message = "";
    try {
      message = JSON.parse(x.values)[0] ?? "";
    } catch {}
    if (!message) {
      try {
        message = JSON.parse(x.list)[0]?.value ?? "";
      } catch {}
    }
    const key = `${x.where}|${message}|${x.version}`;
    const entry = errors.get(key) ?? { where: x.where, message: message.slice(0, 140), version: x.version, count: 0, ids: new Set(), noise: classifyError({ message, list: x.list, ua: x.ua, where: x.where }) };
    entry.count++;
    entry.ids.add(x.id);
    errors.set(key, entry);
  }
  data.site = {
    visitors: uniq(views.map((x) => x.id)),
    pageviews: views.length,
    buckets: buckets.map((s) => s.size),
    referrers: tally(views.map((x) => [REF[x.ref] ?? x.ref, x.id])),
    devices: tally(views.map((x) => [deviceName(x.type, x.os), x.id])),
    countries: tally(views.map((x) => [countryName(x.country), x.id]), 7),
    mac: { visitors: uniq(macViews.map((x) => x.id)), clicked: uniq(downloads.filter((x) => x.os === "Mac OS X" && x.type === "Desktop").map((x) => x.id)) },
    downloadsOther: tally(downloads.filter((x) => !(x.os === "Mac OS X" && x.type === "Desktop")).map((x) => [deviceName(x.type, x.os), x.id])),
    clicks: Object.fromEntries(["github_clicked", "screenshot_opened", "release_notes_viewed", "notify_clicked", "$rageclick", "$dead_click"].map((e) => [e, clicks(e)])),
  };
  data.phones = {
    taps: sends.length,
    people: uniq(sends.map((x) => x.id)),
    outcomes: tally(sends.map((x) => [x.outcome || "opened the panel", x.id])),
    fallback: tally(ofEvent("send_to_mac_fallback").map((x) => [x.action || "other", x.id])),
    macLinkVisits: uniq(ofEvent("mac_link_visit").map((x) => x.id)),
  };
  data.errors = [...errors.values()].map(({ ids, ...e }) => ({ ...e, people: ids.size })).sort((a, b) => b.count - a.count);
}
if (head) {
  const [[allTime, day, downloadsAll, macDownloadsAll, macLinkAll], copies, [appWindow, appToday, appWeek], active] = head[0];
  const range = (i) => ({ low: copies.reduce((s, c) => s + Math.ceil(c[i] / 3), 0), high: copies.reduce((s, c) => s + Number(c[i]), 0) });
  const older = (v) => {
    const [a, b, c] = v.split(".").map(Number);
    return a === 0 && (b < 2 || (b === 2 && c <= 17));
  };
  data.headline = { allTime, day, downloadsAll, macDownloadsAll, macLinkAll };
  data.copies = {
    firstLaunches: copies.reduce((s, c) => s + Number(c[5]), 0),
    firstToday: copies.reduce((s, c) => s + Number(c[4]), 0),
    firstYesterday: copies.reduce((s, c) => s + Number(c[3]), 0),
    today: range(2),
    yesterday: range(1),
    oldVersionsSeen: copies.filter((c) => older(c[0]) && Number(c[1]) + Number(c[2]) > 0).map((c) => c[0]),
  };
  data.app = { window: appWindow, today: appToday, week: appWeek };
  const [dauToday, dauYesterday, wau, wauLastWeek, mau, newToday, newYesterday] = active.slice(0, 7).map(Number);
  const pingSince = [...active[7]].sort(compareVersions)[0] ?? null;
  const silent = pingSince ? copies.filter((c) => compareVersions(c[0], pingSince) < 0) : copies;
  const silentYesterday = { low: silent.reduce((s, c) => s + Math.ceil(c[1] / 3), 0), high: silent.reduce((s, c) => s + Number(c[1]), 0) };
  data.active = { dauToday, dauYesterday, wau, wauLastWeek, mau, newToday, newYesterday, pingSince, silentYesterday };
}

const previous = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : null;
const current = {
  at: now,
  visitors: data.headline?.allTime,
  downloadClickers: data.headline?.downloadsAll,
  dmg: gitHub?.dmg,
  zips: gitHub?.zips,
  firstLaunches: data.copies?.firstLaunches,
  stars: gitHub?.stars,
};
data.previous = previous;

const n = (x) => (x ?? "?").toLocaleString("en-US");
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "–");
const clock = (ms) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ }).toLowerCase();
const zoneName = new Date(now).toLocaleTimeString("en-IN", { timeZoneName: "short", timeZone: TZ }).split(" ").pop();
const dayLabel = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ });
const sameDay = (a, b) => dayLabel(a) === dayLabel(b);
const whenLabel = (ms) => (sameDay(ms, now) ? clock(ms) : `${dayLabel(ms)} ${clock(ms)}`);
const duration = (ms) => {
  const m = Math.round(ms / 60e3);
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
  return `${Math.round(m / 1440)} days`;
};
const list = (pairs) => pairs.map(([k, v]) => `${k} ${n(v)}`).join(", ");
const delta = (a, b) => (a == null || b == null ? null : a - b);
const signed = (x) => (x > 0 ? `+${n(x)}` : x < 0 ? `−${n(-x)}` : "±0");

function trendLine(b) {
  const full = b.slice(0, -1);
  if (full.length < 3) return null;
  const peak = Math.max(...full);
  const peakAt = (origin + full.indexOf(peak) * step) * 1000;
  const recent = full.slice(-2).reduce((s, x) => s + x, 0) / 2;
  const avg = full.reduce((s, x) => s + x, 0) / full.length;
  const unit = step === 900 ? "per 15 min" : step === 3600 ? "an hour" : "a day";
  const word = recent > avg * 1.3 ? "rising" : recent < avg * 0.6 ? "tapering" : "steady";
  return `peak ${peak} ${unit} at ${whenLabel(peakAt)}; now ${Math.round(recent)} ${unit}, ${word}`;
}

function report() {
  const out = [];
  out.push(`**Ardia since ${whenLabel(since)} ${zoneName}** (${duration(span)}, as of ${clock(now)})`);
  if (data.headline || gitHub) {
    out.push("", "**Users**");
    if (gitHub) out.push(`- DMG downloads ${n(gitHub.dmg)} all time; ${gitHub.latest?.version} has ${n(gitHub.latest?.dmg)} DMG, ${n(gitHub.latest?.zip)} update zips (${n(gitHub.zips)} zips all time)`);
    if (data.active) {
      const a = data.active;
      const { low, high } = a.silentYesterday;
      const cover = (extra) => Math.round((100 * a.dauYesterday) / Math.max(1, a.dauYesterday + extra));
      const older = high > 0 ? `; older versions don't send it and ran on another ${n(low)}–${n(high)} copies (update checks ÷ 3 to checks), so about ${n(a.dauYesterday + low)}–${n(a.dauYesterday + high)} in all and the count covers ${cover(high)}–${cover(low)}%` : "";
      out.push(`- Daily active ${n(a.dauYesterday)} counted yesterday, ${n(a.dauToday)} today so far (UTC${a.pingSince ? `, sent by ${a.pingSince} and later` : ""})${older}`);
      const trend = cover(high) >= 95 ? ` (${n(a.wauLastWeek)} last week)` : " (counted copies only: they climb as copies update, so not comparable with last week yet)";
      out.push(`- Weekly ${n(a.wau)} this week, monthly ${n(a.mau)} this month${trend}; new installs ${n(a.newToday)} today, ${n(a.newYesterday)} yesterday`);
    }
    if (data.copies) {
      const c = data.copies;
      out.push(`- First launches ${n(c.firstLaunches)} all time; ${n(c.firstToday)} today, ${n(c.firstYesterday)} yesterday (UTC days)`);
      if (c.oldVersionsSeen.length) out.push(`- Still checking in on ${c.oldVersionsSeen.join(", ")}: their opt-in usage and errors go to PostHog Cloud, which nothing reads`);
    }
    if (data.app) out.push(`- Opted-in app users: ${n(data.app.window)} in the window, ${n(data.app.today)} today, ${n(data.app.week)} in 7 days`);
  }
  if (data.site) {
    const s = data.site;
    out.push("", "**Site**");
    out.push(`- Visitors ${n(s.visitors)} (${n(s.pageviews)} page views); ${n(data.headline?.day)} in 24 h, ${n(data.headline?.allTime)} all time`);
    const trend = trendLine(s.buckets);
    if (trend) out.push(`- Trend: ${trend}`);
    if (s.referrers.length) out.push(`- From: ${list(s.referrers)}`);
    if (s.devices.length) out.push(`- Devices: ${list(s.devices)}`);
    if (s.countries.length) out.push(`- Countries: ${list(s.countries)}`);
    const other = s.downloadsOther.length ? `; also ${list(s.downloadsOther)}` : "";
    out.push(`- Download: ${s.mac.clicked} of ${s.mac.visitors} Mac visitors (${pct(s.mac.clicked, s.mac.visitors)})${other}; ${n(data.headline?.downloadsAll)} people all time (${n(data.headline?.macDownloadsAll)} Mac)`);
    const c = s.clicks;
    out.push(`- GitHub clicks ${c.github_clicked.people}, screenshots ${c.screenshot_opened.people}, release notes ${c.release_notes_viewed.people}, notify ${c.notify_clicked.people}; rage clicks ${c.$rageclick.count} (${c.$rageclick.people} people), dead clicks ${c.$dead_click.count} (${c.$dead_click.people})`);
  }
  if (data.phones) {
    const p = data.phones;
    out.push("", "**Phones**");
    const fallback = p.fallback.length ? `; fallback ${list(p.fallback)}` : "";
    out.push(`- Send to my Mac: ${p.taps} taps by ${p.people} people${p.outcomes.length ? ` → ${list(p.outcomes)}` : ""}${fallback}`);
    out.push(`- Macs that opened a sent link: ${p.macLinkVisits} (${n(data.headline?.macLinkAll)} all time)`);
  }
  if (gitHub) {
    const g = gitHub;
    out.push("", "**GitHub**");
    out.push(`- ${n(g.stars)} stars (${signed(g.starsInWindow)} in the window, ${signed(g.stars24h)} in 24 h), ${n(g.forks)} forks, ${n(g.openIssues)} open ${g.openIssues === 1 ? "issue" : "issues"}`);
    if (g.views) out.push(`- Repo views, 14 days: ${n(g.views.count)} from ${n(g.views.uniques)} people${g.referrers.length ? `; from ${list(g.referrers)}` : ""}`);
  }
  if (data.errors) {
    out.push("", "**Errors**");
    const real = data.errors.filter((e) => !e.noise);
    const noise = data.errors.filter((e) => e.noise);
    if (!real.length) out.push(`- Nothing to fix.${noise.length ? "" : " No exceptions at all."}`);
    for (const e of real) out.push(`- **${e.where}${e.version ? ` ${e.version}` : ""}**: ${e.message} (${e.count}× by ${e.people})`);
    if (noise.length) {
      const groups = tally(noise.flatMap((e) => Array.from({ length: e.count }, (_, i) => [e.noise, `${e.message}${i}`])), 10);
      out.push(`- Noise, not ours: ${groups.map(([k, v]) => `${k} ${v}`).join(", ")}`);
    }
  }
  if (previous) {
    const parts = [
      ["visitors", delta(current.visitors, previous.visitors)],
      ["download clickers", delta(current.downloadClickers, previous.downloadClickers)],
      ["DMG downloads", delta(current.dmg, previous.dmg)],
      ["update zips", delta(current.zips, previous.zips)],
      ["first launches", delta(current.firstLaunches, previous.firstLaunches)],
      ["stars", delta(current.stars, previous.stars)],
    ].filter(([, d]) => d != null);
    out.push("", `**Since the last check** (${whenLabel(previous.at)}, ${duration(now - previous.at)} ago): ${parts.map(([k, d]) => `${k} ${signed(d)}`).join(", ")}`);
  }
  if (problems.length) out.push("", `**Couldn't fetch:** ${problems.join("; ")}`);
  return out.join("\n");
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function svg() {
  const W = 728, P = 20, FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Helvetica, Arial, sans-serif";
  const C = { bg: "#141519", card: "#1c1d22", border: "#2a2b31", text: "#f1f1f3", muted: "#8e8f98", grid: "#26272d", bar: "#5b8cff", dim: "#3a3b42", c2: "#2ec4a6", c3: "#f2b84b" };
  const parts = [];
  const text = (x, y, s, { size = 12, color = C.muted, weight = 400, anchor = "start" } = {}) =>
    parts.push(`<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${esc(s)}</text>`);
  let y = P;
  text(P, y + 14, `Ardia since ${whenLabel(since)} ${zoneName} · ${duration(span)} · as of ${clock(now)}`, { size: 13, color: C.text, weight: 600 });
  y += 30;
  const s = data.site, g = gitHub;
  const tiles = [
    [n(s?.visitors), "site visitors", `${n(s?.pageviews)} page views`],
    [s ? pct(s.mac.clicked, s.mac.visitors) : "–", "Mac download rate", s ? `${s.mac.clicked} of ${s.mac.visitors}` : ""],
    [g ? signed(g.starsInWindow) : "–", "GitHub stars", g ? `${n(g.stars)} total` : ""],
    [n(g?.latest?.dmg), `${g?.latest?.version ?? ""} DMG downloads`, g ? `${n(g.dmg)} all versions` : ""],
    [n(data.copies?.firstToday), "first launches today", data.copies ? `${n(data.copies.firstLaunches)} all time` : ""],
  ];
  const tw = (W - 2 * P - 4 * 8) / 5;
  tiles.forEach(([v, l, sub], i) => {
    const x = P + i * (tw + 8);
    parts.push(`<rect x="${x}" y="${y}" width="${tw}" height="78" rx="10" fill="${C.card}" stroke="${C.border}"/>`);
    text(x + 12, y + 30, v, { size: 22, color: C.text, weight: 600 });
    text(x + 12, y + 48, l, { size: 10.5 });
    text(x + 12, y + 66, sub, { size: 10, color: C.muted });
  });
  y += 100;
  if (s) {
    const unit = step === 900 ? "per 15 min" : step === 3600 ? "per hour" : "per day";
    text(P, y, `Site visitors ${unit} (${zoneName})`, { size: 12, color: C.text, weight: 600 });
    y += 12;
    const H = 150, L = P + 22, B = 20, max = Math.max(4, ...s.buckets), nice = max <= 5 ? 5 : Math.ceil(max / 5) * 5;
    const bw = (W - P - L) / s.buckets.length;
    for (const v of [0, nice / 2, nice]) {
      const gy = y + (H - B) * (1 - v / nice);
      parts.push(`<line x1="${L}" x2="${W - P}" y1="${gy}" y2="${gy}" stroke="${C.grid}"/>`);
      text(L - 6, gy + 4, v, { size: 10, anchor: "end" });
    }
    const every = Math.ceil(s.buckets.length / 7);
    s.buckets.forEach((v, i) => {
      const h = ((H - B) * v) / nice;
      const last = i === s.buckets.length - 1;
      parts.push(`<rect x="${L + i * bw + bw * 0.15}" y="${y + H - B - h}" width="${bw * 0.7}" height="${h}" rx="${Math.min(3, bw * 0.2)}" fill="${C.bar}" opacity="${last ? 0.45 : 1}"/>`);
      if (i % every === 0) {
        const at = (origin + i * step) * 1000;
        text(L + i * bw + bw / 2, y + H - 4, step === 86400 ? dayLabel(at) : clock(at), { size: 10, anchor: "middle" });
      }
    });
    y += H + 18;
    const cols = [["Where from", s.referrers, C.bar], ["Device", s.devices, C.c2], ["Country", s.countries, C.c3]];
    const cw = (W - 2 * P - 2 * 20) / 3;
    const rowsMax = Math.max(...cols.map((c) => c[1].length), 1);
    cols.forEach(([title, pairs, color], ci) => {
      const x = P + ci * (cw + 20);
      text(x, y + 10, title, { size: 12, color: C.text, weight: 600 });
      const top = Math.max(...pairs.map((p) => p[1]), 1);
      pairs.forEach(([k, v], ri) => {
        const ry = y + 26 + ri * 20;
        const label = SHORT[k] ?? String(k);
        text(x, ry + 9, label.length > 12 ? `${label.slice(0, 11)}…` : label, { size: 11 });
        const bx = x + 84, bmax = cw - 84 - 30;
        parts.push(`<rect x="${bx}" y="${ry}" width="${bmax}" height="10" rx="3" fill="${C.grid}"/>`);
        parts.push(`<rect x="${bx}" y="${ry}" width="${Math.max(2, (bmax * v) / top)}" height="10" rx="3" fill="${color}"/>`);
        text(x + cw, ry + 9, v, { size: 11, color: C.text, anchor: "end" });
      });
    });
    y += 26 + rowsMax * 20 + 10;
  }
  if (data.errors) {
    const real = data.errors.filter((e) => !e.noise);
    const line = real.length
      ? `Errors to look at: ${real.map((e) => `${e.where} ${e.message.slice(0, 50)} (${e.count})`).join("; ")}`
      : `Errors: nothing to fix${data.errors.length ? ` (${data.errors.reduce((t, e) => t + e.count, 0)} noise events, not ours)` : ""}`;
    text(P, y + 10, line.slice(0, 120), { size: 11, color: real.length ? C.c3 : C.muted });
    y += 24;
  }
  const height = Math.ceil(y + P - 6);
  return { height, body: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}"><rect width="${W}" height="${height}" rx="14" fill="${C.bg}"/>${parts.join("")}</svg>` };
}

if (!args.includes("--no-save") && current.visitors != null) {
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(current));
}

if (args.includes("--json")) {
  console.log(JSON.stringify(data));
} else {
  mkdirSync(SVG_DIR, { recursive: true });
  const { height, body } = svg();
  const file = join(SVG_DIR, `stats-${now}.svg`);
  writeFileSync(file, body);
  console.log(report());
  console.log(`\nvisual: html_render html='<img src="${file}" style="width:100%;display:block">' height=${height}`);
}
