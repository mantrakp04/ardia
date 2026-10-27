import { DATA_START_MS, windowFor, type RangeKey } from "../../lib/range";
import { compareVersions, isNightly } from "../../lib/versions";
import { num, query } from "../clickhouse";
import { github } from "../github";
import { ACTIVITY_EVENTS, APP_SOURCE, MAC, PHONE, SITE, at, compareStart, since } from "../sql";
import { floorDay } from "../series";
import { checkRows } from "./users";

const DAY = 86_400_000;
const FIRST_COUNTED = "0.2.14";

const STEPS = [
  "macVisitors",
  "macClickers",
  "phoneVisitors",
  "tappers",
  "cancelled",
  "shared",
  "copied",
  "blocked",
  "failed",
  "succeeded",
  "fallback",
  "macLinks",
  "demoCustomize",
  "demoShown",
  "demoCopied",
  "demoDownload",
] as const;

type Counts = Record<(typeof STEPS)[number], number>;

export async function funnelsSite(range: RangeKey, signal?: AbortSignal) {
  const w = windowFor(range);
  const outcome = (o: string) => `max(event = 'send_to_mac_clicked' AND properties['outcome'] = '${o}')`;
  const rows = await query(
    `SELECT period, ${STEPS.map((s) => `countIf(${s})`).join(", ")}
     FROM (
       SELECT distinct_id, timestamp >= ${at(w.start)} AS period,
         max(event = '$pageview' AND ${MAC}) AS macVisitors,
         max(event = 'download_clicked' AND ${MAC}) AND macVisitors AS macClickers,
         max(event = '$pageview' AND ${PHONE}) AS phoneVisitors,
         max(event = 'send_to_mac_clicked') AS tappers,
         ${outcome("cancelled")} AS cancelled,
         ${outcome("shared")} AS shared,
         ${outcome("copied")} AS copied,
         ${outcome("blocked")} AS blocked,
         ${outcome("error")} AS failed,
         shared OR copied AS succeeded,
         max(event = 'send_to_mac_fallback') AS fallback,
         max(event = 'mac_link_visit') AS macLinks,
         max(event = 'demo_customize') AS demoCustomize,
         max(event = 'demo_setup_code_shown') AND demoCustomize AS demoShown,
         max(event = 'demo_setup_code_copied') AND demoCustomize AS demoCopied,
         max(event = 'download_clicked') AND demoCustomize AS demoDownload
       FROM telemetry.events
       WHERE event IN ('$pageview', 'download_clicked', 'send_to_mac_clicked', 'send_to_mac_fallback', 'mac_link_visit', 'demo_customize', 'demo_setup_code_shown', 'demo_setup_code_copied')
         AND ${since(compareStart(w))} AND ${SITE}
       GROUP BY distinct_id, period
     )
     GROUP BY period`,
    signal,
  );
  const of = (period: number): Counts | null => {
    const r = rows.find((x) => num(x[0]) === period);
    return Object.fromEntries(STEPS.map((s, i) => [s, r ? num(r[i + 1]) : 0])) as Counts;
  };
  return { current: of(1)!, previous: w.prevStart === null ? null : of(0) };
}

export async function funnelsInstalls(range: RangeKey, signal?: AbortSignal) {
  const w = windowFor(range);
  const [checks, gh] = await Promise.all([checkRows(signal), github().catch(() => null)]);
  const windowDay = floorDay(w.start);
  const prevDay = w.prevStart === null ? null : floorDay(w.prevStart);
  const firstIn = (from: number, to: number) => checks.filter((r) => r.day >= from && r.day < to).reduce((s, r) => s + r.first, 0);
  const counted = (version: string) => !isNightly(version) && compareVersions(version, FIRST_COUNTED) >= 0;
  const stable = (gh?.releases ?? []).filter((r) => r.tag !== "nightly" && counted(r.version));
  return {
    firstLaunches: firstIn(windowDay, w.end + DAY),
    previousFirstLaunches: prevDay === null ? null : firstIn(prevDay, windowDay),
    allTime: {
      dmg: stable.reduce((s, r) => s + r.dmg, 0),
      first: checks.filter((r) => counted(r.version)).reduce((s, r) => s + r.first, 0),
    },
    githubError: gh ? gh.error : "GitHub is unavailable",
  };
}

export async function funnelsRetention(range: RangeKey, signal?: AbortSignal) {
  const w = windowFor(range);
  const rows = await query(
    `SELECT d0, count(), countIf(has(days, d0 + 1)), countIf(has(days, d0 + 3)), countIf(has(days, d0 + 7)), countIf(length(days) > 1)
     FROM (
       SELECT distinct_id, min(toDate(timestamp)) AS d0, groupUniqArray(toDate(timestamp)) AS days
       FROM telemetry.events
       WHERE event IN (${ACTIVITY_EVENTS}) AND ${since(DATA_START_MS)} AND ${APP_SOURCE}
       GROUP BY distinct_id
     )
     GROUP BY d0 ORDER BY d0`,
    signal,
  );
  const today = floorDay(w.end);
  const cohorts = rows.map((r) => {
    const day = Date.parse(`${String(r[0])}T00:00:00Z`);
    const ready = (k: number) => day + (k + 1) * DAY <= today;
    const size = num(r[1]);
    return {
      day,
      size,
      d1: ready(1) ? num(r[2]) : null,
      d3: ready(3) ? num(r[3]) : null,
      d7: ready(7) ? num(r[4]) : null,
      returned: num(r[5]),
    };
  });
  const windowDay = floorDay(w.start);
  return {
    cohorts: cohorts.filter((c) => c.day >= windowDay),
    allCohorts: cohorts,
    newOptedIn: cohorts.filter((c) => c.day >= windowDay).reduce((s, c) => s + c.size, 0),
  };
}
