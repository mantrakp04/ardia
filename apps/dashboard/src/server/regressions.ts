import { identityOf } from "../lib/identity";
import { THRESHOLDS } from "../lib/thresholds";
import { compareVersions, isNightly } from "../lib/versions";
import { num, query, str } from "./clickhouse";
import { APP_SOURCE, prop } from "./sql";

export type Channel = "stable" | "nightly";

const LOOKBACK_DAYS = 120;
const MIN_PEOPLE = 3;
const RATE_WORSE = 0.25;
const MIN_RATE_EVENTS = 10;
const MIN_SESSIONS = 30;
const CRASH_FREE_DROP = 0.005;
const PEOPLE_SHOWN = 40;

type Unit = "ms" | "mb" | "bytes" | "per1k" | "share";

type MetricDef = {
  key: string;
  source: string;
  label: string;
  group: string;
  unit: Unit;
  stat: "p50" | "p95" | "rate" | "crash-free";
  hint: string;
};

export const REGRESSION_METRICS: MetricDef[] = [
  { key: "j2", source: "j2", label: "New tab to typeable", group: "Journeys", unit: "ms", stat: "p50", hint: "Median of each report's p95 (perf_journeys j2_typeable_p95)" },
  { key: "j3", source: "j3", label: "Tab switch", group: "Journeys", unit: "ms", stat: "p50", hint: "Median of each report's p95 (j3_total_p95)" },
  { key: "j4", source: "j4", label: "Navigation to first paint", group: "Journeys", unit: "ms", stat: "p50", hint: "Median of each report's p95 (j4_fcp_p95)" },
  { key: "launch_p50", source: "launch", label: "Launch to usable, p50", group: "Launch", unit: "ms", stat: "p50", hint: "perf_launch usable_ms" },
  { key: "launch_p95", source: "launch", label: "Launch to usable, p95", group: "Launch", unit: "ms", stat: "p95", hint: "perf_launch usable_ms" },
  { key: "memory_p50", source: "memory", label: "Memory, p50", group: "Memory", unit: "mb", stat: "p50", hint: "perf_memory total_mb, every Ardia process" },
  { key: "memory_p95", source: "memory", label: "Memory, p95", group: "Memory", unit: "mb", stat: "p95", hint: "perf_memory total_mb, every Ardia process" },
  { key: "crash_free", source: "crash", label: "Crash-free sessions", group: "Stability", unit: "share", stat: "crash-free", hint: "1 − app crashes ÷ launches; crashes credited to the version that crashed" },
  { key: "exceptions", source: "exception", label: "JS exceptions per 1k sessions", group: "Stability", unit: "per1k", stat: "rate", hint: "$exception that isn't a crash report, per 1,000 launches" },
  { key: "gone", source: "gone", label: "Page processes gone per 1k sessions", group: "Stability", unit: "per1k", stat: "rate", hint: "page_process_gone per 1,000 launches" },
  { key: "store_bytes", source: "store_bytes", label: "Local telemetry store size, p95", group: "Telemetry store", unit: "bytes", stat: "p95", hint: "telemetry_local_store bytes" },
  { key: "store_write", source: "store_write", label: "Local store write p95", group: "Telemetry store", unit: "ms", stat: "p50", hint: "Median of each hourly report's write time p95" },
];

const USABLE = "toFloat64OrZero(properties['usable_ms'])";
const STORE_WRITE = "toFloat64OrZero(if(properties['write_p95_ms'] != '', properties['write_p95_ms'], properties['write_ms_p95']))";
const VERSION = `if(event = '$exception' AND properties['crashed_version'] != '', properties['crashed_version'], ${prop("$app_version")})`;

const SAMPLES = `
  SELECT v, distinct_id, t.1 AS metric, t.2 AS x
  FROM (
    SELECT ${VERSION} AS v, distinct_id,
      arrayJoin(multiIf(
        event = 'perf_journeys', [('j2', toFloat64OrZero(properties['j2_typeable_p95'])), ('j3', toFloat64OrZero(properties['j3_total_p95'])), ('j4', toFloat64OrZero(properties['j4_fcp_p95']))],
        event = 'perf_launch', [('launch', if(properties['first_of_version'] IN ('true', 'false') AND ${USABLE} < 600000, ${USABLE}, 0))],
        event = 'perf_memory', [('memory', toFloat64OrZero(properties['total_mb']))],
        event = 'telemetry_local_store', [('store_bytes', toFloat64OrZero(properties['bytes'])), ('store_write', ${STORE_WRITE})],
        event = 'app_launched', [('sessions', 1.)],
        event = '$exception' AND properties['source'] = 'native_crash', [('crash', 1.)],
        event = '$exception' AND properties['source'] NOT IN ('native_crash', 'helper_crash'), [('exception', 1.)],
        event = 'page_process_gone', [('gone', 1.)],
        [('none', 0.)]
      )) AS t
    FROM telemetry.events
    WHERE ${APP_SOURCE} AND timestamp >= now() - INTERVAL ${LOOKBACK_DAYS} DAY
      AND event IN ('perf_journeys', 'perf_launch', 'perf_memory', 'telemetry_local_store', 'app_launched', '$exception', 'page_process_gone')
  )
  WHERE v IN ({latest:String}, {previous:String}) AND t.2 > 0`;

export type RegressionRow = {
  key: string;
  label: string;
  group: string;
  unit: Unit;
  hint: string;
  latest: number | null;
  previous: number | null;
  latestN: number;
  previousN: number;
  change: number | null;
  enough: boolean;
  worse: boolean;
  better: boolean;
  affected: number;
  people: { id: string; name: string }[];
};

export async function versionsOn(channel: Channel, signal?: AbortSignal) {
  const rows = await query(
    `SELECT ${prop("$app_version")} AS v, uniq(distinct_id), countIf(event = 'app_launched'), max(toUnixTimestamp64Milli(timestamp))
     FROM telemetry.events
     WHERE ${APP_SOURCE} AND timestamp >= now() - INTERVAL ${LOOKBACK_DAYS} DAY AND v != ''
       AND event IN ('app_launched', 'perf_memory', 'perf_launch', 'usage_counts')
     GROUP BY v`,
    signal,
  );
  return rows
    .map((r) => ({ version: str(r[0]), people: num(r[1]), launches: num(r[2]), lastSeen: num(r[3]) }))
    .filter((r) => /^0\.\d+\.\d+(-nightly\.\d+)?$/.test(r.version) && isNightly(r.version) === (channel === "nightly") && r.people >= MIN_PEOPLE)
    .sort((a, b) => compareVersions(b.version, a.version));
}

export async function getRegressions(input: { channel: Channel; latest?: string; previous?: string }, signal?: AbortSignal) {
  const versions = await versionsOn(input.channel, signal);
  const known = new Set(versions.map((v) => v.version));
  const latest = input.latest && known.has(input.latest) ? input.latest : versions[0]?.version ?? null;
  const older = versions.filter((v) => latest && compareVersions(v.version, latest) < 0);
  const previous = input.previous && known.has(input.previous) && latest && compareVersions(input.previous, latest) < 0 ? input.previous : older[0]?.version ?? null;
  if (!latest || !previous) return { channel: input.channel, versions, latest, previous, sessions: { latest: 0, previous: 0 }, people: { latest: 0, previous: 0 }, rows: [] as RegressionRow[] };

  const params = { latest, previous };
  const [byVersion, byPerson] = await Promise.all([
    query(`SELECT v, metric, count(), quantiles(0.5, 0.95)(x), uniq(distinct_id) FROM (${SAMPLES}) GROUP BY v, metric`, signal, undefined, params),
    query(`SELECT metric, distinct_id, count(), quantiles(0.5, 0.95)(x) FROM (${SAMPLES}) WHERE v = {latest:String} GROUP BY metric, distinct_id`, signal, undefined, params),
  ]);

  const cell = (v: string, metric: string) => {
    const r = byVersion.find((x) => str(x[0]) === v && str(x[1]) === metric);
    const q = (r?.[3] as number[] | undefined) ?? [];
    return r ? { n: num(r[2]), p50: num(q[0]), p95: num(q[1]), people: num(r[4]) } : { n: 0, p50: 0, p95: 0, people: 0 };
  };
  const sessions = { latest: cell(latest, "sessions").n, previous: cell(previous, "sessions").n };
  const personRows = byPerson.map((r) => ({ metric: str(r[0]), id: str(r[1]), n: num(r[2]), p50: num((r[3] as number[])?.[0]), p95: num((r[3] as number[])?.[1]) }));

  const rows: RegressionRow[] = REGRESSION_METRICS.map((m) => {
    const a = cell(latest, m.source);
    const b = cell(previous, m.source);
    let value: number | null;
    let before: number | null;
    let enough: boolean;
    let worse = false;
    let better = false;
    let change: number | null = null;
    let affectedIds: string[] = [];
    if (m.stat === "rate" || m.stat === "crash-free") {
      const rate = (count: number, base: number) => (base ? (m.stat === "rate" ? (1000 * count) / base : Math.max(0, 1 - count / base)) : null);
      value = rate(a.n, sessions.latest);
      before = rate(b.n, sessions.previous);
      enough = sessions.latest >= MIN_SESSIONS && sessions.previous >= MIN_SESSIONS;
      if (value !== null && before !== null) {
        if (m.stat === "rate") {
          change = before ? (value - before) / before : value > 0 ? null : 0;
          worse = enough && a.n >= MIN_RATE_EVENTS && (before === 0 ? value > 0 : value > before * (1 + RATE_WORSE));
          better = enough && before > 0 && value < before * (1 - RATE_WORSE);
        } else {
          change = value - before;
          worse = enough && a.n >= MIN_RATE_EVENTS && before - value >= CRASH_FREE_DROP;
          better = enough && value - before >= CRASH_FREE_DROP;
        }
      }
      affectedIds = personRows.filter((p) => p.metric === m.source).map((p) => p.id);
    } else {
      value = a.n ? (m.stat === "p95" ? a.p95 : a.p50) : null;
      before = b.n ? (m.stat === "p95" ? b.p95 : b.p50) : null;
      enough = a.n >= THRESHOLDS.minPerfSamples && b.n >= THRESHOLDS.minPerfSamples;
      if (value !== null && before) {
        change = (value - before) / before;
        worse = enough && change >= THRESHOLDS.perfWorse;
        better = enough && change <= -THRESHOLDS.perfWorse;
      }
      if (before !== null) affectedIds = personRows.filter((p) => p.metric === m.source && (m.stat === "p95" ? p.p95 : p.p50) > before!).map((p) => p.id);
    }
    return {
      key: m.key,
      label: m.label,
      group: m.group,
      unit: m.unit,
      hint: m.hint,
      latest: value,
      previous: before,
      latestN: a.n,
      previousN: b.n,
      change,
      enough,
      worse,
      better,
      affected: affectedIds.length,
      people: affectedIds.slice(0, PEOPLE_SHOWN).map((id) => ({ id, name: identityOf(id).name })),
    };
  });

  return {
    channel: input.channel,
    versions,
    latest,
    previous,
    sessions,
    people: { latest: versions.find((v) => v.version === latest)?.people ?? 0, previous: versions.find((v) => v.version === previous)?.people ?? 0 },
    rows,
  };
}
