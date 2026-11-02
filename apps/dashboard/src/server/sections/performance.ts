import { windowFor, type RangeKey } from "../../lib/range";
import { compareVersions, isNightly } from "../../lib/versions";
import { num, query, str } from "../clickhouse";
import { APP_SOURCE, prop, since } from "../sql";

const LAUNCH_KIND = `multiIf(properties['first_of_version'] = 'true' AND properties['cold'] = 'true', 'first-cold', properties['first_of_version'] = 'true', 'first', properties['cold'] = 'true', 'cold', 'warm')`;
const PROFILES = `multiIf(toUInt32OrZero(properties['profiles']) <= 3, properties['profiles'], toUInt32OrZero(properties['profiles']) <= 5, '4–5', toUInt32OrZero(properties['profiles']) <= 9, '6–9', '10+')`;
const TABS = `multiIf(toUInt32OrZero(properties['tabs']) = 0, '0', toUInt32OrZero(properties['tabs']) <= 5, '1–5', toUInt32OrZero(properties['tabs']) <= 20, '6–20', toUInt32OrZero(properties['tabs']) <= 50, '21–50', '51+')`;

export const METRICS = ["launch", "omnibox_p50", "omnibox_p95", "switch", "memory"] as const;
export type Metric = (typeof METRICS)[number];

export type Quantiles = { count: number; p50: number; p90: number; p99: number };

export async function performanceAll(range: RangeKey, signal?: AbortSignal) {
  const w = windowFor(range);
  const launchMs = "toFloat64OrZero(properties['usable_ms'])";
  const rows = await query(
    `SELECT metric, grp, v, count(), quantiles(0.5, 0.9, 0.99)(x)
     FROM (
       SELECT if(${prop("$app_version")} = '', 'unknown', ${prop("$app_version")}) AS v,
         arrayJoin(multiIf(
           event = 'perf_launch', [('launch', ${LAUNCH_KIND}, ${launchMs}), ('launch', 'all', ${launchMs})],
           event = 'perf_omnibox', [('omnibox_p50', 'all', toFloat64OrZero(properties['p50_ms'])), ('omnibox_p95', 'all', toFloat64OrZero(properties['p95_ms']))],
           event = 'profile_switched', [('switch', ${PROFILES}, toFloat64OrZero(properties['switch_ms'])), ('switch', 'all', toFloat64OrZero(properties['switch_ms']))],
           [('memory', ${TABS}, toFloat64OrZero(properties['total_mb'])), ('memory', 'all', toFloat64OrZero(properties['total_mb']))]
         )) AS t,
         t.1 AS metric, t.2 AS grp, t.3 AS x
       FROM telemetry.events
       WHERE event IN ('perf_launch', 'perf_omnibox', 'profile_switched', 'perf_memory') AND ${since(w.start)} AND ${APP_SOURCE}
         AND (event != 'perf_launch' OR (properties['first_of_version'] IN ('true', 'false') AND ${launchMs} > 0 AND ${launchMs} < 600000))
         AND (event != 'perf_memory' OR toFloat64OrZero(properties['total_mb']) > 0)
         AND (event != 'profile_switched' OR properties['switch_ms'] != '')
     )
     GROUP BY GROUPING SETS ((metric, grp, v), (metric, grp))`,
    signal,
  );
  const cells = rows.map((r) => {
    const q = (r[4] as number[]) ?? [];
    return { metric: str(r[0]) as Metric, group: str(r[1]), version: str(r[2]), count: num(r[3]), p50: num(q[0]), p90: num(q[1]), p99: num(q[2]) };
  });
  const overall = cells.filter((c) => c.version === "");
  const byVersion = cells.filter((c) => c.version !== "");
  const versions = [...new Set(byVersion.map((c) => c.version))].sort((a, b) => compareVersions(b, a));
  const cell = (list: typeof cells, metric: Metric, group: string) => {
    const c = list.find((x) => x.metric === metric && x.group === group);
    return c ? { count: c.count, p50: c.p50, p90: c.p90, p99: c.p99 } : null;
  };
  const groups = (metric: Metric, order: string[]) =>
    order.map((group) => ({ group, ...(cell(overall, metric, group) ?? { count: 0, p50: 0, p90: 0, p99: 0 }) })).filter((g) => g.count > 0);
  return {
    start: w.start,
    launch: groups("launch", ["warm", "cold", "first", "first-cold"]),
    switching: groups("switch", ["1", "2", "3", "4–5", "6–9", "10+"]),
    memory: groups("memory", ["0", "1–5", "6–20", "21–50", "51+"]),
    overall: {
      launch: cell(overall, "launch", "all"),
      omnibox50: cell(overall, "omnibox_p50", "all"),
      omnibox95: cell(overall, "omnibox_p95", "all"),
      switching: cell(overall, "switch", "all"),
      memory: cell(overall, "memory", "all"),
    },
    versions: versions.map((version) => {
      const list = byVersion.filter((c) => c.version === version);
      return {
        version,
        nightly: isNightly(version),
        warm: cell(list, "launch", "warm"),
        first: cell(list, "launch", "first"),
        launch: cell(list, "launch", "all"),
        omnibox50: cell(list, "omnibox_p50", "all"),
        omnibox95: cell(list, "omnibox_p95", "all"),
        switching: cell(list, "switch", "all"),
        memory: cell(list, "memory", "all"),
      };
    }),
  };
}
