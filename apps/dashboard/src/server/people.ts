import { identityOf, shortId } from "../lib/identity";
import { compareVersions } from "../lib/versions";
import { num, query, str } from "./clickhouse";
import { reportsFor, withStatus, type ReportWithStatus } from "./feedback-reports";
import { describeEvent, groupSessions, markReports, SLOW_JOURNEYS, type TimelineEvent, type TimelineSession } from "./people-timeline";
import { APP_SOURCE, prop } from "./sql";

export const PEOPLE_PAGE_SIZE = 50;
export const CLI_SOURCE = `(source = 'ardia-cli')`;
export const FEEDBACK_EVENTS = `event IN ('feedback_submitted', 'cli_feedback')`;
export const PERSON_EVENTS = `(${APP_SOURCE} OR ${CLI_SOURCE} OR event = 'feedback_submitted') AND event != 'daily_active' AND distinct_id != ''`;
export const CRASH = `(event = '$exception' AND properties['source'] IN ('native_crash', 'helper_crash'))`;
export const CHANNEL = `if(properties['channel'] != '', properties['channel'], if(position(${prop("$app_version")}, '-nightly') > 0, 'nightly', 'stable'))`;
const TIMELINE_LIMIT = 400;
const VALUE_CAP = 1500;
const PEOPLE_CACHE = { freshMs: 2 * 60_000, keepMs: 30 * 60_000 };

const SLOW = `(${SLOW_JOURNEYS.map((j) => `toFloat64OrZero(properties['${j.key}']) > ${j.over}`).join(" OR ")})`;

export const TIMELINE_EVENTS = [
  "app_launched",
  "app_updated",
  "app_session_ended",
  "$exception",
  "page_process_gone",
  "perf_journeys",
  "cli_command",
  "feedback_submitted",
  "cli_feedback",
  "sharing_turned_on",
] as const;

export type PersonRow = {
  id: string;
  name: string;
  firstSeen: number;
  lastSeen: number;
  version: string;
  cliVersion: string;
  channel: string;
  chip: string;
  memoryGb: number;
  crashes: number;
  reports: number;
  events: number;
  usesApp: boolean;
  usesCli: boolean;
  watchReport: string;
  watchUntil: number | null;
};

export type PeopleSort = "last" | "first" | "crashes" | "reports";
export const PEOPLE_SORTS: readonly PeopleSort[] = ["last", "first", "crashes", "reports"];

const parseWhen = (value: string): number | null => {
  if (!value) return null;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
};

const PEOPLE_COLUMNS = `distinct_id,
  min(toUnixTimestamp64Milli(timestamp)),
  max(toUnixTimestamp64Milli(timestamp)),
  argMaxIf(${prop("$app_version")}, timestamp, ${APP_SOURCE} AND ${prop("$app_version")} != ''),
  argMaxIf(properties['cli_version'], timestamp, ${CLI_SOURCE}),
  argMaxIf(${CHANNEL}, timestamp, ${APP_SOURCE} AND ${prop("$app_version")} != ''),
  argMaxIf(properties['chip'], timestamp, event = 'app_launched' AND properties['chip'] != ''),
  argMaxIf(properties['memory_gb'], timestamp, event = 'app_launched' AND properties['memory_gb'] != ''),
  countIf(${CRASH}),
  countIf(${FEEDBACK_EVENTS}),
  count(),
  countIf(${APP_SOURCE}) > 0,
  countIf(${CLI_SOURCE}) > 0,
  argMaxIf(properties['watch_report'], timestamp, properties['watch_report'] != ''),
  argMaxIf(properties['watch_until'], timestamp, event = 'feedback_submitted' AND properties['watch_until'] != '')`;

function personRow(r: unknown[]): PersonRow {
  const id = str(r[0]);
  return {
    id,
    name: identityOf(id).name,
    firstSeen: num(r[1]),
    lastSeen: num(r[2]),
    version: str(r[3]),
    cliVersion: str(r[4]),
    channel: str(r[3]) ? str(r[5]) : "",
    chip: str(r[6]),
    memoryGb: num(r[7]),
    crashes: num(r[8]),
    reports: num(r[9]),
    events: num(r[10]),
    usesApp: num(r[11]) === 1,
    usesCli: num(r[12]) === 1,
    watchReport: str(r[13]),
    watchUntil: parseWhen(str(r[14])),
  };
}

export async function allPeople(signal?: AbortSignal): Promise<PersonRow[]> {
  const rows = await query(
    `SELECT ${PEOPLE_COLUMNS}
     FROM telemetry.events
     WHERE ${PERSON_EVENTS}
     GROUP BY distinct_id`,
    signal,
    PEOPLE_CACHE,
  );
  return rows.map(personRow);
}

export type PeopleInput = { search: string; page: number; sort: PeopleSort; channel: "" | "stable" | "nightly"; only: "" | "crashed" | "reported" | "cli" | "watching" };

const SORTERS: Record<PeopleSort, (a: PersonRow, b: PersonRow) => number> = {
  last: (a, b) => b.lastSeen - a.lastSeen,
  first: (a, b) => b.firstSeen - a.firstSeen,
  crashes: (a, b) => b.crashes - a.crashes || b.lastSeen - a.lastSeen,
  reports: (a, b) => b.reports - a.reports || b.lastSeen - a.lastSeen,
};

export function filterPeople(people: PersonRow[], input: PeopleInput, now = Date.now()) {
  const needle = input.search.trim().toLowerCase();
  return people
    .filter((p) => {
      if (needle && !p.name.toLowerCase().includes(needle) && !p.id.toLowerCase().startsWith(needle)) return false;
      if (input.channel && p.channel !== input.channel) return false;
      if (input.only === "crashed" && !p.crashes) return false;
      if (input.only === "reported" && !p.reports) return false;
      if (input.only === "cli" && !p.usesCli) return false;
      if (input.only === "watching" && !(p.watchUntil && p.watchUntil > now)) return false;
      return true;
    })
    .sort(SORTERS[input.sort]);
}

export async function listPeople(input: PeopleInput, signal?: AbortSignal) {
  const people = await allPeople(signal);
  const matching = filterPeople(people, input);
  const pageCount = Math.max(1, Math.ceil(matching.length / PEOPLE_PAGE_SIZE));
  const page = Math.min(input.page, pageCount);
  const now = Date.now();
  return {
    total: people.length,
    matching: matching.length,
    page,
    pageCount,
    pageSize: PEOPLE_PAGE_SIZE,
    counts: {
      seenWeek: people.filter((p) => now - p.lastSeen < 7 * 86_400_000).length,
      crashed: people.filter((p) => p.crashes > 0).length,
      reported: people.filter((p) => p.reports > 0).length,
      cli: people.filter((p) => p.usesCli).length,
      watching: people.filter((p) => p.watchUntil && p.watchUntil > now).length,
    },
    rows: matching.slice((page - 1) * PEOPLE_PAGE_SIZE, page * PEOPLE_PAGE_SIZE),
  };
}

export type PersonDetail = {
  person: PersonRow;
  shortId: string;
  os: string;
  arch: string;
  gpu: string;
  engine: string;
  versions: { version: string; first: number; last: number }[];
  reports: ReportWithStatus[];
  sessions: TimelineSession[];
  before: number | null;
  truncated: boolean;
};

export async function getPerson(id: string, before: number | null, signal?: AbortSignal): Promise<PersonDetail | null> {
  const who = `distinct_id = {id:String}`;
  const [[head], extra, versions, timeline, reports, activity] = await Promise.all([
    query(`SELECT ${PEOPLE_COLUMNS} FROM telemetry.events WHERE ${PERSON_EVENTS} AND ${who} GROUP BY distinct_id`, signal, undefined, { id }),
    query(
      `SELECT argMaxIf(properties['$os_version'], timestamp, properties['$os_version'] != ''), argMaxIf(properties['arch'], timestamp, properties['arch'] != ''),
         argMaxIf(properties['gpu'], timestamp, event = 'app_launched' AND properties['gpu'] != ''), argMaxIf(properties['engine_version'], timestamp, properties['engine_version'] != '')
       FROM telemetry.events WHERE ${PERSON_EVENTS} AND ${who}`,
      signal,
      undefined,
      { id },
    ),
    query(
      `SELECT ${prop("$app_version")} AS v, min(toUnixTimestamp64Milli(timestamp)), max(toUnixTimestamp64Milli(timestamp))
       FROM telemetry.events WHERE ${APP_SOURCE} AND ${who} AND v != '' GROUP BY v`,
      signal,
      undefined,
      { id },
    ),
    query(
      `SELECT uuid, toUnixTimestamp64Milli(timestamp), event, session_id, if(${CLI_SOURCE}, properties['cli_version'], ${prop("$app_version")}),
         mapApply((k, v) -> (k, substring(v, 1, ${VALUE_CAP})), mapFilter((k, v) -> k NOT IN ('$exception_list', 'distinct_id', 'event', 'uuid') AND v != '', properties)),
         if(event = '$exception', substring(properties['$exception_list'], 1, 6000), '')
       FROM telemetry.events
       WHERE ${PERSON_EVENTS} AND ${who} AND event IN (${TIMELINE_EVENTS.map((e) => `'${e}'`).join(", ")})
         AND (event != 'perf_journeys' OR ${SLOW})
         ${before ? `AND timestamp < toDateTime64({before:Float64} / 1000, 3, 'UTC')` : ""}
       ORDER BY timestamp DESC
       LIMIT ${TIMELINE_LIMIT + 1}`,
      signal,
      undefined,
      before ? { id, before } : { id },
    ),
    reportsFor(id, signal).then((list) => withStatus(list, signal)),
    query(
      `SELECT DISTINCT toUnixTimestamp(toStartOfFiveMinutes(timestamp)) * 1000
       FROM telemetry.events
       WHERE ${APP_SOURCE} AND ${who} AND session_id = '' ${before ? `AND timestamp < toDateTime64({before:Float64} / 1000, 3, 'UTC')` : ""}
       ORDER BY 1 DESC
       LIMIT 20000`,
      signal,
      undefined,
      before ? { id, before } : { id },
    ),
  ]);
  if (!head) return null;
  const person = personRow(head);
  const truncated = timeline.length > TIMELINE_LIMIT;
  const events: TimelineEvent[] = timeline.slice(0, TIMELINE_LIMIT).map((r) => {
    const event = str(r[2]);
    const properties = { ...((r[5] as Record<string, string>) ?? {}) };
    if (str(r[6])) properties.$exception_list = str(r[6]);
    return { id: str(r[0]), at: num(r[1]), event, session: str(r[3]), version: str(r[4]), properties, ...describeEvent(event, properties) };
  });
  const oldest = truncated ? events.at(-1)!.at : 0;
  const seen = new Set(events.map((x) => x.id));
  for (const r of reports) {
    if (seen.has(r.uuid) || r.at < oldest || (before && r.at >= before)) continue;
    const properties: Record<string, string> = { feedback_id: r.id, kind: r.kind, title: r.title, ...(r.version ? { [r.source === "cli" ? "cli_version" : "app_version"]: r.version } : {}) };
    events.push({ id: r.uuid, at: r.at, event: r.legacy ? "cli_feedback" : "feedback_submitted", session: "", version: r.version, properties, ...describeEvent(r.legacy ? "cli_feedback" : "feedback_submitted", properties) });
  }
  const e = extra[0] ?? [];
  return {
    person,
    shortId: shortId(id),
    os: str(e[0]),
    arch: str(e[1]),
    gpu: str(e[2]),
    engine: str(e[3]),
    versions: versions.map((r) => ({ version: str(r[0]), first: num(r[1]), last: num(r[2]) })).sort((a, b) => compareVersions(b.version, a.version)),
    reports,
    sessions: groupSessions(markReports(events), activity.map((r) => num(r[0]))),
    before: truncated ? events.at(-1)!.at : null,
    truncated,
  };
}
