import { readFileSync } from "node:fs";
import { identityOf } from "../lib/identity";
import { num, query, str, type QueryParams } from "./clickhouse";
import { isDev, serverEnv } from "./env";
import { feedbackFileBases } from "./feedback-files";
import { fixStatus, type FixStatus, type InstallHistory, type Issue } from "./fix-status";
import { gh, github } from "./github";
import { APP_SOURCE, prop } from "./sql";

const REPO = "mantrakp04/ardia";
const ISSUE_TTL_MS = 10 * 60_000;
const LIST_LIMIT = 500;
const REPORT_CACHE = { freshMs: 60_000, keepMs: 10 * 60_000 };

export const REPORT_ID = /^(FB-[A-Z0-9]{3,16}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const RID = `coalesce(nullIf(properties['feedback_id'], ''), nullIf(properties['reference'], ''), nullIf(properties['id'], ''), uuid)`;
const FEEDBACK = `event IN ('feedback_submitted', 'cli_feedback')`;

export type Attachment = { name: string; bytes: number; type: string; url: string };

export type Report = {
  id: string;
  uuid: string;
  at: number;
  legacy: boolean;
  kind: string;
  title: string;
  description: string;
  source: "app" | "cli";
  person: string;
  name: string;
  version: string;
  build: string;
  channel: string;
  os: string;
  arch: string;
  contact: string;
  pageAddress: string;
  watchDays: number;
  watchUntil: number | null;
  attachments: Attachment[];
  issueNumber: number | null;
  issueUrl: string;
  agent: string;
  command: string;
  recent: string[];
  diagnostics: string;
};

export type ReportWithStatus = Report & { issue: Issue | null; status: FixStatus };

const jsonList = <T>(raw: string): T[] => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
};

const parseWhen = (value: string): number | null => {
  if (!value) return null;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
};

const firstLine = (text: string) => {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 67 ? `${line.slice(0, 66)}…` : line;
};

function toReport(uuid: string, at: number, event: string, distinctId: string, rid: string, p: Record<string, string>): Report {
  const legacy = event === "cli_feedback";
  const id = legacy ? uuid : rid;
  const attachments = jsonList<{ name?: unknown; bytes?: unknown; type?: unknown }>(p.attachments ?? "")
    .filter((a) => typeof a?.name === "string" && /^[\w.-]{1,120}$/.test(a.name as string))
    .map((a) => ({ name: a.name as string, bytes: num(a.bytes), type: str(a.type), url: `/files/feedback/${encodeURIComponent(id)}/${encodeURIComponent(a.name as string)}` }));
  const issueNumber = num(p.issue_number) || Number(/\/issues\/(\d+)/.exec(p.issue_url ?? "")?.[1] ?? 0) || null;
  const version = legacy ? str(p.cli_version) : str(p.app_version || p.$app_version || p.cli_version);
  const text = legacy ? str(p.text) : str(p.description);
  return {
    id,
    uuid,
    at,
    legacy,
    kind: legacy ? "agent" : str(p.kind) || "other",
    title: legacy ? firstLine(text) || "Agent feedback" : str(p.title) || "Untitled",
    description: text,
    source: legacy || p.source === "cli" ? "cli" : "app",
    person: distinctId,
    name: distinctId ? identityOf(distinctId).name : "Unknown",
    version,
    build: str(p.app_build),
    channel: str(p.channel) || (version.includes("-nightly") ? "nightly" : version ? "stable" : ""),
    os: str(p.os_version || p.$os_version),
    arch: str(p.arch),
    contact: str(p.contact),
    pageAddress: str(p.page_address),
    watchDays: num(p.watch_days),
    watchUntil: parseWhen(str(p.watch_until)),
    attachments,
    issueNumber,
    issueUrl: str(p.issue_url) || (issueNumber ? `https://github.com/${REPO}/issues/${issueNumber}` : ""),
    agent: legacy ? str(p.agent) || "ardia" : "",
    command: str(p.about_command),
    recent: jsonList<unknown>(p.recent_commands ?? "").filter((x): x is string => typeof x === "string"),
    diagnostics: str(p.diagnostics),
  };
}

type FixtureEvent = { uuid: string; timestamp: string | number; event: string; distinct_id: string; properties: Record<string, string | number | boolean> };

function fixtureReports(): Report[] {
  const file = isDev ? serverEnv("DASHBOARD_FEEDBACK_FIXTURE") : undefined;
  if (!file) return [];
  try {
    const events = JSON.parse(readFileSync(file, "utf8")) as FixtureEvent[];
    return events.map((e) => {
      const p = Object.fromEntries(Object.entries(e.properties).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
      return toReport(e.uuid, parseWhen(String(e.timestamp)) ?? 0, e.event, e.distinct_id, str(p.feedback_id) || e.uuid, p);
    });
  } catch (error) {
    console.error("[feedback] fixture unreadable:", (error as Error).message);
    return [];
  }
}

async function loadReports(where: string, params: QueryParams, full: boolean, signal?: AbortSignal): Promise<Report[]> {
  const rows = await query(
    `SELECT uuid, toUnixTimestamp64Milli(timestamp), event, distinct_id, ${RID},
       ${full ? "properties" : `mapApply((k, v) -> (k, if(k IN ('description', 'text'), substring(v, 1, 600), v)), mapFilter((k, v) -> k NOT IN ('diagnostics', '$exception_list'), properties))`}
     FROM telemetry.events
     WHERE ${FEEDBACK} AND ${where}
     ORDER BY timestamp DESC
     LIMIT ${LIST_LIMIT}`,
    signal,
    REPORT_CACHE,
    params,
  );
  return rows.map((r) => toReport(str(r[0]), num(r[1]), str(r[2]), str(r[3]), str(r[4]), (r[5] as Record<string, string>) ?? {}));
}

export async function reportsFor(person: string, signal?: AbortSignal): Promise<Report[]> {
  const [rows, fixture] = await Promise.all([loadReports("distinct_id = {person:String}", { person }, false, signal), Promise.resolve(fixtureReports())]);
  return [...fixture.filter((r) => r.person === person), ...rows].sort((a, b) => b.at - a.at);
}

const issues = new Map<number, { at: number; data: Promise<Issue | null> }>();

export function issue(number: number): Promise<Issue | null> {
  const hit = issues.get(number);
  if (hit && Date.now() - hit.at < ISSUE_TTL_MS) return hit.data;
  const data = gh(`repos/${REPO}/issues/${number}`)
    .then(({ body }) => {
      const b = body as { number: number; state: string; state_reason: string | null; closed_at: string | null; title: string; html_url: string };
      return { number: b.number, state: b.state === "closed" ? "closed" : "open", reason: b.state_reason ?? "", closedAt: b.closed_at ? Date.parse(b.closed_at) : null, title: b.title, url: b.html_url } as Issue;
    })
    .catch(async () => (hit ? hit.data : null));
  issues.set(number, { at: Date.now(), data });
  return data;
}


const EXCEPTION_TYPE = `coalesce(nullIf(JSONExtractString(properties['$exception_types'], 1), ''), nullIf(JSONExtractString(properties['$exception_list'], 1, 'type'), ''), 'Error')`;

async function histories(people: string[], since: number, signal?: AbortSignal): Promise<Map<string, InstallHistory>> {
  const out = new Map<string, InstallHistory>();
  const ids = people.filter((p) => /^[\w-]{6,64}$/.test(p));
  if (!ids.length) return out;
  const params = { ids: ids.join(","), since: since / 1000 };
  const [versions, exceptions] = await Promise.all([
    query(
      `SELECT distinct_id, groupUniqArray(${prop("$app_version")}) FROM telemetry.events
       WHERE ${APP_SOURCE} AND distinct_id IN splitByChar(',', {ids:String}) AND timestamp >= toDateTime64({since:Float64}, 3, 'UTC') AND ${prop("$app_version")} != ''
       GROUP BY distinct_id`,
      signal,
      REPORT_CACHE,
      params,
    ),
    query(
      `SELECT distinct_id, toUnixTimestamp64Milli(timestamp), if(properties['crashed_version'] != '', properties['crashed_version'], ${prop("$app_version")}), ${EXCEPTION_TYPE}
       FROM telemetry.events
       WHERE event = '$exception' AND distinct_id IN splitByChar(',', {ids:String}) AND timestamp >= toDateTime64({since:Float64} - 86400, 3, 'UTC')
       ORDER BY timestamp
       LIMIT 5000`,
      signal,
      REPORT_CACHE,
      params,
    ),
  ]);
  const entry = (id: string) => {
    let h = out.get(id);
    if (!h) out.set(id, (h = { versions: [], exceptions: [] }));
    return h;
  };
  for (const r of versions) entry(str(r[0])).versions = ((r[1] as string[]) ?? []).map(str);
  for (const r of exceptions) entry(str(r[0])).exceptions.push({ at: num(r[1]), version: str(r[2]), type: str(r[3]) });
  return out;
}

export async function withStatus(reports: Report[], signal?: AbortSignal): Promise<ReportWithStatus[]> {
  if (!reports.length) return [];
  const numbers = [...new Set(reports.map((r) => r.issueNumber).filter((n): n is number => n !== null))];
  const [found, gitHub, history] = await Promise.all([
    Promise.all(numbers.map(async (n) => [n, await issue(n)] as const)).then((pairs) => new Map(pairs)),
    github().catch(() => null),
    histories([...new Set(reports.map((r) => r.person))], Math.min(...reports.map((r) => r.at)), signal),
  ]);
  const releases = gitHub?.releases ?? [];
  return reports.map((r) => {
    const i = r.issueNumber ? found.get(r.issueNumber) ?? null : null;
    return { ...r, issue: i, status: fixStatus(r, i, releases, history.get(r.person)) };
  });
}

export async function listFeedback(signal?: AbortSignal) {
  const rows = await loadReports("1", {}, false, signal);
  const all = [...fixtureReports(), ...rows].sort((a, b) => b.at - a.at);
  return withStatus(all, signal);
}

export async function getFeedbackReport(id: string, signal?: AbortSignal) {
  const fixture = fixtureReports().find((r) => r.id.toLowerCase() === id.toLowerCase() || r.uuid === id.toLowerCase());
  const rows = fixture ? [fixture] : await loadReports(`(${RID} = {id:String} OR uuid = {id:String})`, { id }, true, signal);
  const [report] = await withStatus(rows.slice(0, 1), signal);
  return report ?? null;
}

export function feedbackFilesBases(): string[] {
  return feedbackFileBases(serverEnv);
}

export function feedbackFilesHeaders(): Record<string, string> {
  const token = serverEnv("FEEDBACK_FILES_TOKEN") ?? serverEnv("REPLAYS_TOKEN");
  return token ? { Authorization: `Bearer ${token}` } : {};
}
