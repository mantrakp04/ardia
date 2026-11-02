import { windowFor, type RangeKey } from "../../lib/range";
import { NULL_VALUE, OTHER_VALUE, SETTINGS_SINCE, TINT_KEY, TINT_SWITCH_KEY } from "../../lib/settings";
import { compareVersions, isNightly } from "../../lib/versions";
import { num, query, str } from "../clickhouse";
import { dayBuckets } from "../series";
import { APP_SOURCE, dayBucket, prop, since } from "../sql";

const TOP_VALUES = 5;
const DAY = 86_400_000;
const WEEK = 7 * DAY;

const SNAPSHOT = `(event = 'settings_snapshot' AND ${APP_SOURCE})`;
const VERSION = `if(${prop("$app_version")} = '', 'unknown', ${prop("$app_version")})`;
const KEYS = `arrayDistinct(arrayMap(name -> replaceRegexpOne(name, '^(setting|default)_', ''), arrayFilter(name -> match(name, '^(setting|default)_.'), mapKeys(p))))`;
const encoded = (prefix: "setting" | "default") => `if(p[concat('${prefix}_', k)] IN ('', '${NULL_VALUE}'), '${NULL_VALUE}', p[concat('${prefix}_', k)])`;
const VALUE = encoded("setting");
const DEFAULT = encoded("default");
const WEEK_BUCKET = "toUnixTimestamp(toDateTime(toMonday(timestamp), 'UTC')) * 1000";
const AMOUNT = `toFloat64OrNull(p['setting_${TINT_KEY}'])`;
const TINT_ON = `p['setting_${TINT_SWITCH_KEY}'] = 'true'`;

export function settingsSql(start: number) {
  const scope = `${SNAPSHOT} AND ${since(start)}`;
  return {
    latest: `SELECT k, v, ${VALUE} AS val, ${DEFAULT} AS dflt, count(), countIf(latest)
       FROM (
         SELECT p, v, t = max(t) OVER (PARTITION BY id) AS latest
         FROM (
           SELECT distinct_id AS id, ${VERSION} AS v, argMax(properties, timestamp) AS p, max(timestamp) AS t
           FROM telemetry.events
           WHERE ${scope}
           GROUP BY id, v
         )
       )
       ARRAY JOIN ${KEYS} AS k
       GROUP BY k, v, val, dflt`,
    daily: `SELECT day, k, ${VALUE} AS val, val = ${DEFAULT} AS on_default, count()
       FROM (
         SELECT ${dayBucket} AS day, distinct_id AS id, argMax(properties, timestamp) AS p
         FROM telemetry.events
         WHERE ${scope}
         GROUP BY day, id
       )
       ARRAY JOIN ${KEYS} AS k
       GROUP BY day, k, val, on_default`,
    tint: `SELECT toUInt64(0) AS week, ${AMOUNT} AS amount, count()
       FROM (
         SELECT distinct_id AS id, argMax(properties, timestamp) AS p
         FROM telemetry.events
         WHERE ${scope}
         GROUP BY id
       )
       WHERE ${TINT_ON} AND amount IS NOT NULL
       GROUP BY week, amount
       UNION ALL
       SELECT week, ${AMOUNT} AS amount, count()
       FROM (
         SELECT toUInt64(${WEEK_BUCKET}) AS week, distinct_id AS id, argMax(properties, timestamp) AS p
         FROM telemetry.events
         WHERE ${scope}
         GROUP BY week, id
       )
       WHERE ${TINT_ON} AND amount IS NOT NULL
       GROUP BY week, amount`,
  };
}

type Kind = "boolean" | "number" | "enum";

const isNumeric = (value: string) => value !== "" && Number.isFinite(Number(value));

function kindOf(values: string[]): Kind {
  const known = values.filter((v) => v !== NULL_VALUE);
  if (known.length && known.every((v) => v === "true" || v === "false")) return "boolean";
  if (known.length && known.every(isNumeric)) return "number";
  return "enum";
}

function orderValues(kind: Kind, counts: Map<string, number>, current: string): string[] {
  const values = [...counts.keys()];
  if (kind === "number") return values.sort((a, b) => (a === NULL_VALUE ? 1 : b === NULL_VALUE ? -1 : Number(a) - Number(b)));
  return values.sort((a, b) => (a === current ? -1 : b === current ? 1 : (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b)));
}

const newestVersion = (versions: string[]) => {
  const known = versions.filter((v) => v !== "unknown").sort((a, b) => compareVersions(b, a));
  return known[0] ?? versions[0] ?? null;
};

const add = <K>(map: Map<K, number>, key: K, n: number) => map.set(key, (map.get(key) ?? 0) + n);

export type SettingVersion = { version: string; nightly: boolean; installs: number; default: string; onDefault: number; values: { value: string; installs: number }[]; defaultChanged: boolean };

export async function settingsOverview(range: RangeKey, signal?: AbortSignal) {
  const w = windowFor(range);
  const sql = settingsSql(w.start);
  const days = dayBuckets(w.start, w.end);
  const [latestRows, dailyRows] = await Promise.all([query(sql.latest, signal), query(sql.daily, signal)]);

  const byKey = new Map<string, { key: string; version: string; value: string; dflt: string; perVersion: number; latest: number }[]>();
  for (const r of latestRows) {
    const row = { key: str(r[0]), version: str(r[1]), value: str(r[2]), dflt: str(r[3]), perVersion: num(r[4]), latest: num(r[5]) };
    const list = byKey.get(row.key) ?? [];
    list.push(row);
    byKey.set(row.key, list);
  }

  const dailyByKey = new Map<string, { day: number; value: string; onDefault: boolean; installs: number }[]>();
  for (const r of dailyRows) {
    const key = str(r[1]);
    const list = dailyByKey.get(key) ?? [];
    list.push({ day: num(r[0]), value: str(r[2]), onDefault: num(r[3]) === 1, installs: num(r[4]) });
    dailyByKey.set(key, list);
  }

  const allVersions = new Set<string>();
  const settings = [...byKey.entries()].map(([key, rows]) => {
    const installs = rows.reduce((s, r) => s + r.latest, 0);
    const onDefault = rows.reduce((s, r) => s + (r.value === r.dflt ? r.latest : 0), 0);
    const valueCounts = new Map<string, number>();
    const offDefault = new Map<string, number>();
    for (const r of rows) {
      if (r.latest) add(valueCounts, r.value, r.latest);
      if (r.latest && r.value !== r.dflt) add(offDefault, r.value, r.latest);
    }

    const versionMap = new Map<string, { installs: number; onDefault: number; defaults: Map<string, number>; values: Map<string, number> }>();
    for (const r of rows) {
      allVersions.add(r.version);
      const v = versionMap.get(r.version) ?? { installs: 0, onDefault: 0, defaults: new Map(), values: new Map() };
      v.installs += r.perVersion;
      if (r.value === r.dflt) v.onDefault += r.perVersion;
      add(v.defaults, r.dflt, r.perVersion);
      add(v.values, r.value, r.perVersion);
      versionMap.set(r.version, v);
    }
    const dominant = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? NULL_VALUE;
    const ascending = [...versionMap.keys()].sort(compareVersions);
    const newest = newestVersion(ascending);
    const currentDefault = newest ? dominant(versionMap.get(newest)!.defaults) : NULL_VALUE;
    const versions: SettingVersion[] = ascending
      .map((version, i) => {
        const v = versionMap.get(version)!;
        const dflt = dominant(v.defaults);
        const before = i > 0 && version !== "unknown" ? ascending.slice(0, i).filter((x) => x !== "unknown").pop() : undefined;
        return {
          version,
          nightly: isNightly(version),
          installs: v.installs,
          default: dflt,
          onDefault: v.onDefault,
          values: [...v.values.entries()].map(([value, n]) => ({ value, installs: n })).sort((a, b) => b.installs - a.installs),
          defaultChanged: before !== undefined && dominant(versionMap.get(before)!.defaults) !== dflt,
        };
      })
      .reverse();
    const changedIn = versions.find((v) => v.defaultChanged)?.version ?? null;

    const top = [...offDefault.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? null;
    const kind = kindOf([...valueCounts.keys(), currentDefault]);
    const byCount = [...valueCounts.keys()].sort((a, b) => (valueCounts.get(b) ?? 0) - (valueCounts.get(a) ?? 0) || a.localeCompare(b));
    const shown = new Set([currentDefault, ...byCount.slice(0, TOP_VALUES)]);
    const ordered = orderValues(kind, new Map([...shown].map((v) => [v, valueCounts.get(v) ?? 0])), currentDefault);

    const perDay = new Map<number, { total: number; onDefault: number; values: Map<string, number> }>();
    for (const d of dailyByKey.get(key) ?? []) {
      const day = perDay.get(d.day) ?? { total: 0, onDefault: 0, values: new Map() };
      day.total += d.installs;
      if (d.onDefault) day.onDefault += d.installs;
      add(day.values, shown.has(d.value) ? d.value : OTHER_VALUE, d.installs);
      perDay.set(d.day, day);
    }
    const hasOther = [...perDay.values()].some((d) => d.values.has(OTHER_VALUE));
    const seriesValues = hasOther ? [...ordered, OTHER_VALUE] : ordered;

    return {
      key,
      kind,
      currentDefault,
      newestVersion: newest,
      changedIn,
      installs,
      onDefault,
      onDefaultShare: installs ? onDefault / installs : null,
      topValue: top ? { value: top[0], installs: top[1], share: installs ? top[1] / installs : 0 } : null,
      trend: days.flatMap((t) => {
        const d = perDay.get(t);
        return d && d.total ? [d.onDefault / d.total] : [];
      }),
      daily: {
        reported: days.map((t) => perDay.get(t)?.total ?? 0),
        series: seriesValues.map((value) => ({
          value,
          values: days.map((t) => {
            const d = perDay.get(t);
            return d && d.total ? (d.values.get(value) ?? 0) / d.total : null;
          }),
        })),
      },
      versions,
    };
  });

  return {
    days,
    since: SETTINGS_SINCE,
    installs: Math.max(0, ...settings.map((s) => s.installs)),
    newestVersion: newestVersion([...allVersions]),
    settings: settings.sort((a, b) => a.key.localeCompare(b.key)),
  };
}

function weightedStats(points: { amount: number; installs: number }[]) {
  const sorted = [...points].sort((a, b) => a.amount - b.amount);
  const n = sorted.reduce((s, p) => s + p.installs, 0);
  if (!n) return { installs: 0, median: null, mean: null };
  const at = (rank: number) => {
    let seen = 0;
    for (const p of sorted) {
      seen += p.installs;
      if (seen > rank) return p.amount;
    }
    return sorted[sorted.length - 1]!.amount;
  };
  const median = n % 2 ? at((n - 1) / 2) : (at(n / 2 - 1) + at(n / 2)) / 2;
  const mean = sorted.reduce((s, p) => s + p.amount * p.installs, 0) / n;
  return { installs: n, median, mean };
}

const tintBucket = (amount: number) => Math.min(9, Math.max(0, Math.floor(amount * 10 + 1e-9)));

export async function settingsTint(range: RangeKey, signal?: AbortSignal) {
  const w = windowFor(range);
  const rows = await query(settingsSql(w.start).tint, signal);
  const overall: { amount: number; installs: number }[] = [];
  const weekly = new Map<number, { amount: number; installs: number }[]>();
  for (const r of rows) {
    const point = { amount: num(r[1]), installs: num(r[2]) };
    const week = num(r[0]);
    if (week === 0) overall.push(point);
    else weekly.set(week, [...(weekly.get(week) ?? []), point]);
  }
  const histogram = Array.from({ length: 10 }, (_, i) => ({ from: i / 10, to: (i + 1) / 10, installs: 0 }));
  for (const p of overall) histogram[tintBucket(p.amount)]!.installs += p.installs;
  const firstWeek = Math.floor((w.start - 4 * DAY) / WEEK) * WEEK + 4 * DAY;
  const weeks: number[] = [];
  for (let t = firstWeek; t <= w.end; t += WEEK) weeks.push(t);
  return {
    ...weightedStats(overall),
    histogram,
    weeks: weeks.map((t) => ({ week: t, ...weightedStats(weekly.get(t) ?? []) })),
  };
}
