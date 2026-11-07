import type { PerformanceTrend, TrendFamily, TrendSeries } from "../../lib/performance-trends";
import { windowFor, type RangeKey } from "../../lib/range";
import { num, query, str } from "../clickhouse";
import { APP_SOURCE, bucket, since } from "../sql";
import { LAUNCH_KIND, PROFILES, TABS } from "./performance";

const LAUNCH_MS = "toFloat64OrZero(properties['usable_ms'])";
const SWITCH_MS = "toFloat64OrZero(properties['switch_ms'])";
const MEMORY_MB = "toFloat64OrZero(properties['total_mb'])";

const FAMILY: Record<TrendFamily, { event: string; pairs: string; where: string }> = {
  launch: {
    event: "perf_launch",
    pairs: `[(${LAUNCH_KIND}, ${LAUNCH_MS}), ('all', ${LAUNCH_MS})]`,
    where: `properties['first_of_version'] IN ('true', 'false') AND ${LAUNCH_MS} > 0 AND ${LAUNCH_MS} < 600000`,
  },
  switch: {
    event: "profile_switched",
    pairs: `[(${PROFILES}, ${SWITCH_MS}), ('all', ${SWITCH_MS})]`,
    where: "properties['switch_ms'] != ''",
  },
  memory: {
    event: "perf_memory",
    pairs: `[(${TABS}, ${MEMORY_MB}), ('all', ${MEMORY_MB})]`,
    where: `${MEMORY_MB} > 0`,
  },
  omnibox: {
    event: "perf_omnibox",
    pairs: "[('p50', toFloat64OrZero(properties['p50_ms'])), ('p95', toFloat64OrZero(properties['p95_ms']))]",
    where: "1",
  },
};

export async function performanceTrend(range: RangeKey, family: TrendFamily, signal?: AbortSignal): Promise<PerformanceTrend> {
  const w = windowFor(range);
  const f = FAMILY[family];
  const rows = await query(
    `SELECT b, t.1 AS grp, count(), quantiles(0.5, 0.9, 0.99)(t.2)
     FROM (
       SELECT ${bucket(w.step)} AS b, arrayJoin(${f.pairs}) AS t
       FROM telemetry.events
       WHERE event = '${f.event}' AND ${since(w.start)} AND ${APP_SOURCE} AND ${f.where}
     )
     GROUP BY b, grp`,
    signal,
  );
  const index = new Map(w.buckets.map((b, i) => [b, i]));
  const groups: Record<string, TrendSeries> = {};
  const empty = (): TrendSeries => ({
    count: w.buckets.map(() => 0),
    p50: w.buckets.map(() => null),
    p90: w.buckets.map(() => null),
    p99: w.buckets.map(() => null),
  });
  for (const r of rows) {
    const i = index.get(num(r[0]));
    if (i === undefined) continue;
    const series = (groups[str(r[1])] ??= empty());
    const q = (r[3] as number[]) ?? [];
    series.count[i] = num(r[2]);
    series.p50[i] = num(q[0]);
    series.p90[i] = num(q[1]);
    series.p99[i] = num(q[2]);
  }
  return { family, step: w.step, buckets: w.buckets, groups };
}
