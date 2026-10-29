import { stepMs, windowFor, type RangeKey } from "../../lib/range";
import { num, query, str } from "../clickhouse";
import { classifyNoise } from "../noise";
import { APP_SOURCE, SITE, prop, since } from "../sql";
import { windowInfo } from "../series";

const WHERE = `if(${SITE}, 'site', 'app')`;
const TYPE = `coalesce(nullIf(JSONExtractString(properties['$exception_types'], 1), ''), nullIf(JSONExtractString(properties['$exception_list'], 1, 'type'), ''), 'Error')`;
const MESSAGE = `substring(coalesce(nullIf(JSONExtractString(properties['$exception_values'], 1), ''), JSONExtractString(properties['$exception_list'], 1, 'value')), 1, 300)`;
const FILTER = `event = '$exception' AND (${SITE} OR ${APP_SOURCE})`;

type Frame = { function?: string; filename?: string; module?: string; lineno?: number | null; colno?: number | null };

function framesOf(list: string): string[] {
  try {
    const parsed = JSON.parse(list) as { stacktrace?: { frames?: Frame[] } }[];
    return parsed
      .flatMap((entry) => entry.stacktrace?.frames ?? [])
      .reverse()
      .slice(0, 40)
      .map((frame) => {
        const file = frame.filename || frame.module || "";
        const line = frame.lineno ? `:${frame.lineno}${frame.colno ? `:${frame.colno}` : ""}` : "";
        const fn = frame.function && frame.function !== "?" ? frame.function : "anonymous";
        return file ? `${fn}  ${file}${line}` : fn;
      });
  } catch {
    return [];
  }
}

function hashId(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export async function errorsExceptions(range: RangeKey, signal?: AbortSignal) {
  const w = windowFor(range);
  const [recent, history] = await Promise.all([
    query(
      `SELECT uuid, toUnixTimestamp64Milli(timestamp), ${WHERE}, distinct_id, ${TYPE}, ${MESSAGE},
         if(${SITE}, properties['release_version'], ${prop("$app_version")}),
         substring(properties['$exception_list'], 1, 12000), properties['$raw_user_agent'], properties['$current_url'],
         if(${SITE}, concat(${prop("$browser")}, ' ', properties['$browser_version'], ' · ', ${prop("$os")}), concat('macOS ', properties['$os_version'], ' · ', properties['arch'])),
         properties['$exception_level'], properties['crash_signal']
       FROM telemetry.events
       WHERE ${FILTER} AND ${since(w.start)}
       ORDER BY timestamp DESC
       LIMIT 3000`,
      signal,
    ),
    query(
      `SELECT ${WHERE} AS place, ${TYPE} AS type, ${MESSAGE} AS message, count(), min(toUnixTimestamp64Milli(timestamp)), max(toUnixTimestamp64Milli(timestamp))
       FROM telemetry.events
       WHERE ${FILTER}
       GROUP BY place, type, message`,
      signal,
    ),
  ]);

  const historyByKey = new Map(history.map((r) => [`${str(r[0])}|${str(r[1])}|${str(r[2])}`, { total: num(r[3]), firstSeen: num(r[4]), lastSeen: num(r[5]) }]));
  type Row = { id: string; at: number; where: "site" | "app"; person: string; type: string; message: string; version: string; list: string; ua: string; url: string; platform: string; level: string; crashSignal: string };
  const rows: Row[] = recent.map((r) => ({
    id: str(r[0]),
    at: num(r[1]),
    where: str(r[2]) === "site" ? "site" : "app",
    person: str(r[3]),
    type: str(r[4]),
    message: str(r[5]),
    version: str(r[6]),
    list: str(r[7]),
    ua: str(r[8]),
    url: str(r[9]),
    platform: str(r[10]).trim(),
    level: str(r[11]),
    crashSignal: str(r[12]),
  }));

  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = `${row.where}|${row.type}|${row.message}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const size = stepMs(w.step);
  const series = { app: w.buckets.map(() => 0), site: w.buckets.map(() => 0), noise: w.buckets.map(() => 0) };
  const out = [...groups].map(([key, list]) => {
    const head = list[0]!;
    const noise = classifyNoise(head.where, head.message, head.list, head.ua);
    for (const r of list) {
      const i = Math.min(series.app.length - 1, Math.floor((r.at - w.start) / size));
      if (i >= 0) (noise ? series.noise : series[r.where])[i]!++;
    }
    const versions = new Map<string, number>();
    for (const r of list) versions.set(r.version || "unknown", (versions.get(r.version || "unknown") ?? 0) + 1);
    const past = historyByKey.get(key);
    return {
      id: hashId(key),
      where: head.where,
      type: head.type,
      message: head.message,
      noise,
      count: list.length,
      people: new Set(list.map((r) => r.person)).size,
      total: past?.total ?? list.length,
      firstSeen: past?.firstSeen ?? Math.min(...list.map((r) => r.at)),
      lastSeen: past?.lastSeen ?? head.at,
      versions: [...versions].map(([version, count]) => ({ version, count })).sort((a, b) => b.count - a.count),
      recent: list.slice(0, 8).map((r) => ({ id: r.id, at: r.at, version: r.version, url: r.url, platform: r.platform, level: r.level, crashSignal: r.crashSignal, frames: framesOf(r.list) })),
    };
  });

  return {
    window: windowInfo(w),
    groups: out.sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen),
    series: [
      { key: "app", label: "App", values: series.app },
      { key: "site", label: "Site", values: series.site },
      { key: "noise", label: "Noise", values: series.noise },
    ],
  };
}

export async function errorsLogs(range: RangeKey, signal?: AbortSignal) {
  const w = windowFor(range);
  const rows = await query(
    `SELECT source, level, substring(message, 1, 240) AS text, count(), max(toUnixTimestamp64Milli(timestamp))
     FROM telemetry.logs
     WHERE ${since(w.start)}
     GROUP BY source, level, text
     ORDER BY 4 DESC
     LIMIT 60`,
    signal,
  );
  return rows.map((r) => ({ source: str(r[0]), level: str(r[1]), message: str(r[2]), count: num(r[3]), lastSeen: num(r[4]) }));
}
