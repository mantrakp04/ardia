import { windowFor, type RangeKey } from "../../lib/range";
import { num, query, str } from "../clickhouse";
import { THRESHOLDS } from "../../lib/thresholds";
import { MAC, PHONE, SITE, TRACKED_SITE_EVENTS, bucket, compareStart, isCurrent, isPrevious, since, prop } from "../sql";
import { fill, windowInfo } from "../series";

const COUNTRY = new Intl.DisplayNames(["en"], { type: "region" });
const countryName = (code: string) => {
  if (!code) return "Unknown";
  try {
    return COUNTRY.of(code) ?? code;
  } catch {
    return code;
  }
};

const REFERRERS: Record<string, string> = { $direct: "Direct", "": "Direct", "t.co": "X (t.co)", "www.google.com": "Google" };

const deviceName = (type: string, os: string) => {
  if (type === "Desktop") return os === "Mac OS X" ? "Mac" : os || "Desktop";
  if (os === "iOS") return type === "Tablet" ? "iPad" : "iPhone";
  if (os === "Android") return type === "Tablet" ? "Android tablet" : "Android";
  return os || type || "Other";
};

const CLICK_EVENTS = [
  ["download_clicked", "Download"],
  ["github_clicked", "GitHub"],
  ["screenshot_opened", "Screenshot opened"],
  ["release_notes_viewed", "Release notes"],
  ["notify_clicked", "Notify me"],
  ["discord_clicked", "Discord"],
  ["send_to_mac_clicked", "Send to my Mac"],
  ["demo_customize", "Demo: customize"],
  ["demo_setup_code_copied", "Demo: setup code copied"],
  ["bench_row_switched", "Bench row switched"],
] as const;

export async function siteTraffic(range: RangeKey, signal?: AbortSignal) {
  const w = windowFor(range);
  const cur = isCurrent(w);
  const prev = isPrevious(w);
  const rows = await query(
    `SELECT ${bucket(w.step)} AS b,
       uniqIf(distinct_id, ${cur}), countIf(${cur}), uniqIf(distinct_id, ${MAC} AND ${cur}),
       uniqIf(distinct_id, ${cur}), countIf(${cur}), uniqIf(session_id, ${cur}), uniqIf(distinct_id, ${MAC} AND ${cur}), uniqIf(distinct_id, ${PHONE} AND ${cur}),
       uniqIf(distinct_id, ${prev}), countIf(${prev}), uniqIf(session_id, ${prev}), uniqIf(distinct_id, ${MAC} AND ${prev}), uniqIf(distinct_id, ${PHONE} AND ${prev})
     FROM telemetry.events
     WHERE event = '$pageview' AND ${since(compareStart(w))} AND ${SITE}
     GROUP BY GROUPING SETS ((b), ())`,
    signal,
  );
  const total = (rows.find((r) => num(r[0]) === 0) ?? []).map(num);
  const buckets = rows.filter((r) => num(r[0]) !== 0);
  const hasPrev = w.prevStart !== null;
  const pair = (i: number) => ({ value: total[i] ?? 0, previous: hasPrev ? (total[i + 5] ?? 0) : null });
  return {
    window: windowInfo(w),
    kpis: { visitors: pair(4), pageviews: pair(5), sessions: pair(6), mac: pair(7), phones: pair(8) },
    trend: [
      { key: "visitors", label: "Visitors", values: fill(w.buckets, buckets, 1) },
      { key: "mac", label: "Mac visitors", values: fill(w.buckets, buckets, 3) },
    ],
  };
}

export async function siteBreakdowns(range: RangeKey, signal?: AbortSignal) {
  const w = windowFor(range);
  const rows = await query(
    `SELECT dim, key, uniq(distinct_id) AS visitors, count() AS views
     FROM (
       SELECT distinct_id,
         arrayJoin([
           ('page', ${prop("$pathname")}),
           ('referrer', ${prop("$referring_domain")}),
           ('utm', concat(coalesce(nullIf(properties['utm_source'], ''), nullIf(properties['$session_entry_utm_source'], ''), ''), ' / ',
                          coalesce(nullIf(properties['utm_medium'], ''), nullIf(properties['$session_entry_utm_medium'], ''), '–'), ' / ',
                          coalesce(nullIf(properties['utm_campaign'], ''), nullIf(properties['$session_entry_utm_campaign'], ''), '–'))),
           ('country', ${prop("$geoip_country_code")}),
           ('device', concat(${prop("$device_type")}, '|', ${prop("$os")})),
           ('browser', ${prop("$browser")}),
           ('language', properties['$browser_language_prefix'])
         ]) AS pair,
         pair.1 AS dim, pair.2 AS key
       FROM telemetry.events
       WHERE event = '$pageview' AND ${since(w.start)} AND ${SITE}
     )
     GROUP BY dim, key
     ORDER BY dim, visitors DESC
     LIMIT 40 BY dim`,
    signal,
  );
  const of = (dim: string) => rows.filter((r) => str(r[0]) === dim).map((r) => ({ key: str(r[1]), value: num(r[2]), secondary: num(r[3]) }));
  const devices = new Map<string, number>();
  for (const d of of("device")) {
    const [type = "", os = ""] = d.key.split("|");
    const name = deviceName(type, os);
    devices.set(name, (devices.get(name) ?? 0) + d.value);
  }
  return {
    pages: of("page").map((r) => ({ ...r, label: safeDecode(r.key) || "/" })),
    referrers: of("referrer").map((r) => ({ ...r, label: REFERRERS[r.key] ?? r.key })),
    utm: of("utm")
      .filter((r) => !r.key.startsWith(" / ") && !/infracheck|selftest/i.test(r.key))
      .map((r) => ({ ...r, label: r.key.replace(/ \/ –/g, "") })),
    countries: of("country").map((r) => ({ ...r, key: r.key || "unknown", label: countryName(r.key) })),
    devices: [...devices].map(([label, value]) => ({ key: label, label, value })).sort((a, b) => b.value - a.value),
    browsers: of("browser").map((r) => ({ key: r.key || "unknown", label: r.key || "Unknown", value: r.value })),
    languages: of("language").map((r) => ({ key: r.key || "unknown", label: r.key || "Unknown", value: r.value })),
  };
}

function elementLabel(text: string) {
  const styled = /^\.([\w-]+)\s*\{/.exec(text);
  return styled ? `.${styled[1]} (no text)` : text.trim();
}

function safeDecode(text: string) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export async function siteClicks(range: RangeKey, signal?: AbortSignal) {
  const w = windowFor(range);
  const cur = isCurrent(w);
  const prev = isPrevious(w);
  const events = CLICK_EVENTS.map(([e]) => `'${e}'`).join(", ");
  const rows = await query(
    `SELECT kind, key, countIf(${cur}) AS n, uniqIf(distinct_id, ${cur}) AS people, countIf(${prev}), uniqIf(distinct_id, ${prev})
     FROM (
       SELECT distinct_id, timestamp,
         arrayJoin(if(event = 'download_clicked', [('event', event), ('location', properties['location'])], [('event', event)])) AS pair,
         pair.1 AS kind, pair.2 AS key
       FROM telemetry.events
       WHERE event IN (${events}) AND ${since(compareStart(w))} AND ${SITE}
     )
     GROUP BY kind, key
     ORDER BY kind, n DESC
     LIMIT 60 BY kind`,
    signal,
  );
  const hasPrev = w.prevStart !== null;
  const of = (kind: string) => rows.filter((r) => str(r[0]) === kind);
  const byEvent = new Map(of("event").map((r) => [str(r[1]), r.map(num)]));
  return {
    locations: of("location")
      .filter((r) => num(r[2]) > 0)
      .map((r) => ({ key: str(r[1]) || "unknown", label: str(r[1]) || "Unknown", value: num(r[3]), secondary: num(r[2]) })),
    clicks: CLICK_EVENTS.map(([event, label]) => {
      const r = byEvent.get(event) ?? [];
      return { key: event, label, count: r[2] ?? 0, people: r[3] ?? 0, previousCount: hasPrev ? (r[4] ?? 0) : null, previousPeople: hasPrev ? (r[5] ?? 0) : null };
    }),
  };
}

const MAX_SPOTS = 80;
const FRICTION_KIND: Record<string, "Rage" | "Dead" | "Swipe"> = { $rageclick: "Rage", $dead_click: "Dead", $dead_swipe: "Swipe" };

export async function siteFriction(range: RangeKey, signal?: AbortSignal) {
  const w = windowFor(range);
  const cur = isCurrent(w);
  const prev = isPrevious(w);
  const from = since(compareStart(w));
  const ms = "toUnixTimestamp64Milli(timestamp)";
  const explained = `arrayExists(x -> abs(x - ${ms}) < ${THRESHOLDS.frictionWindowMs}, t.ts)`;
  const real = `NOT ${explained}`;
  const [groups, visitors] = await Promise.all([
    query(
      `WITH tracked AS (
         SELECT session_id, groupArray(toUnixTimestamp64Milli(timestamp)) AS ts
         FROM telemetry.events
         WHERE event IN (${TRACKED_SITE_EVENTS}) AND ${from} AND ${SITE} AND session_id != ''
         GROUP BY session_id
       )
       SELECT event AS kind, substring(properties['$el_text'], 1, 90) AS text, ${prop("$pathname")} AS path, ${bucket(w.step)} AS b,
         countIf(${real} AND ${cur}), uniqIf(distinct_id, ${real} AND ${cur}),
         countIf(${explained} AND ${cur}),
         countIf(${real} AND ${prev}), uniqIf(distinct_id, ${real} AND ${prev}),
         max(${ms}), argMaxIf(f.session_id, timestamp, ${real} AND f.session_id != '')
       FROM telemetry.events AS f
       LEFT JOIN tracked AS t ON t.session_id = f.session_id
       WHERE event IN ('$rageclick', '$dead_click', '$dead_swipe') AND ${from} AND ${SITE}
       GROUP BY GROUPING SETS ((kind, text, path), (b), ())`,
      signal,
    ),
    query(
      `SELECT ${prop("$pathname")} AS path, ${bucket(w.step)} AS b, uniqIf(distinct_id, ${cur}), uniqIf(distinct_id, ${prev})
       FROM telemetry.events
       WHERE event = '$pageview' AND ${from} AND ${SITE}
       GROUP BY GROUPING SETS ((path), (b), ())`,
      signal,
    ),
  ]);
  const byPath = new Map(visitors.filter((r) => str(r[0]) !== "" && num(r[1]) === 0).map((r) => [str(r[0]), { cur: num(r[2]), prev: num(r[3]) }]));
  const total = visitors.find((r) => str(r[0]) === "" && num(r[1]) === 0);
  const visitorsByBucket = visitors.filter((r) => str(r[0]) === "" && num(r[1]) !== 0);
  const groupRows = groups.filter((r) => str(r[0]) !== "");
  const bucketRows = groups.filter((r) => str(r[0]) === "" && num(r[3]) !== 0);
  const overall = groups.find((r) => str(r[0]) === "" && num(r[3]) === 0);
  const hasPrev = w.prevStart !== null;
  const series = w.buckets.map((b) => {
    const f = bucketRows.find((r) => num(r[3]) === b);
    const v = visitorsByBucket.find((r) => num(r[1]) === b);
    const people = v ? num(v[2]) : 0;
    return people ? (100 * (f ? num(f[5]) : 0)) / people : 0;
  });
  const spots = groupRows
    .map((r) => {
      const path = str(r[2]);
      const pageVisitors = byPath.get(path);
      const people = num(r[5]);
      const previousPeople = hasPrev ? num(r[8]) : null;
      return {
        kind: FRICTION_KIND[str(r[0])] ?? "Dead",
        text: elementLabel(str(r[1])),
        path,
        count: num(r[4]),
        people,
        explained: num(r[6]),
        previousCount: hasPrev ? num(r[7]) : null,
        previousPeople,
        pageVisitors: pageVisitors?.cur ?? 0,
        previousPageVisitors: hasPrev ? (pageVisitors?.prev ?? 0) : null,
        rate: pageVisitors?.cur ? (100 * people) / pageVisitors.cur : null,
        previousRate: hasPrev && pageVisitors?.prev ? (100 * (previousPeople ?? 0)) / pageVisitors.prev : null,
        lastSeen: num(r[9]),
        session: str(r[10]),
      };
    })
    .filter((s) => s.count > 0 || s.explained > 0)
    .sort((a, b) => b.people - a.people || b.count - a.count);
  const shown = spots.filter((s) => s.count > 0).slice(0, MAX_SPOTS);
  return {
    window: windowInfo(w),
    visitors: total ? num(total[2]) : 0,
    previousVisitors: hasPrev && total ? num(total[3]) : null,
    people: overall ? num(overall[5]) : 0,
    previousPeople: hasPrev && overall ? num(overall[8]) : null,
    explained: spots.reduce((s, x) => s + x.explained, 0),
    events: spots.reduce((s, x) => s + x.count, 0),
    series,
    spots: shown,
    hidden: spots.length - shown.length,
  };
}

function normalCdf(z: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export async function siteExperiment(range: RangeKey, signal?: AbortSignal) {
  const w = windowFor(range);
  const rows = await query(
    `SELECT variant, count(), countIf(clicked_after), countIf(band_click)
     FROM (
       SELECT distinct_id,
         argMinIf(properties['$feature_flag_response'], timestamp, event = '$feature_flag_called') AS variant,
         minIf(timestamp, event = '$feature_flag_called') AS exposed_at,
         maxIf(timestamp, event = 'download_clicked') >= exposed_at AND countIf(event = 'download_clicked') > 0 AS clicked_after,
         countIf(event = 'download_clicked' AND properties['location'] = 'office-band') > 0 AS band_click
       FROM telemetry.events
       WHERE event IN ('$feature_flag_called', 'download_clicked') AND ${since(w.start)} AND ${SITE}
       GROUP BY distinct_id
       HAVING countIf(event = '$feature_flag_called' AND properties['$feature_flag'] = 'download-band') > 0
     )
     GROUP BY variant ORDER BY variant`,
    signal,
  );
  const variants = rows.map((r) => ({ variant: str(r[0]) || "unknown", exposed: num(r[1]), clicked: num(r[2]), bandClicks: num(r[3]) }));
  const control = variants.find((v) => v.variant === "control");
  const band = variants.find((v) => v.variant === "band");
  let pValue: number | null = null;
  if (control && band && control.exposed > 0 && band.exposed > 0) {
    const pooled = (control.clicked + band.clicked) / (control.exposed + band.exposed);
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / control.exposed + 1 / band.exposed));
    if (se > 0) pValue = 2 * (1 - normalCdf(Math.abs((band.clicked / band.exposed - control.clicked / control.exposed) / se)));
  }
  return { variants, pValue };
}

export async function siteVitals(range: RangeKey, signal?: AbortSignal) {
  const w = windowFor(range);
  const metric = (m: string) =>
    `quantileIf(0.75)(toFloat64OrZero(properties['$web_vitals_${m}_value']), properties['$web_vitals_${m}_value'] != ''), countIf(properties['$web_vitals_${m}_value'] != '')`;
  const rows = await query(
    `SELECT ${["LCP", "INP", "CLS", "FCP"].map(metric).join(", ")}
     FROM telemetry.events WHERE event = '$web_vitals' AND ${since(w.start)} AND ${SITE}`,
    signal,
  );
  const v = (rows[0] ?? []).map(num);
  return [
    { key: "LCP", label: "Largest contentful paint", p75: v[0] ?? 0, samples: v[1] ?? 0, unit: "ms", good: 2500, poor: 4000 },
    { key: "INP", label: "Interaction to next paint", p75: v[2] ?? 0, samples: v[3] ?? 0, unit: "ms", good: 200, poor: 500 },
    { key: "CLS", label: "Cumulative layout shift", p75: v[4] ?? 0, samples: v[5] ?? 0, unit: "", good: 0.1, poor: 0.25 },
    { key: "FCP", label: "First contentful paint", p75: v[6] ?? 0, samples: v[7] ?? 0, unit: "ms", good: 1800, poor: 3000 },
  ];
}
