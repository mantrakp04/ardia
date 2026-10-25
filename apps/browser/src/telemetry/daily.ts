import { launchEnvironment, readDocument, saveDocument, updaterState } from "@ardia/shell";
import { appInfo, environment, logRequest, uuidv4, type RequestLogEntry } from "./client";
import { DEV_SEND_ENV, LOGS_URL } from "./config";
import { EVENTS_SCOPE, eventRecord, logsRequest, outcome } from "./otlp";

export const DAILY_DOC = "telemetry-daily.json";
export const DAILY_EVENT = "daily_active";
export const DAILY_LIB = "ardia-daily";

const FIRST_PING_DELAY_MS = 30_000;
const RECHECK_MS = 60 * 60_000;
const MIDNIGHT_JITTER_MS = 5 * 60_000;
const FIRST_RETRY_MS = 60_000;
const MAX_RETRY_MS = 60 * 60_000;
export const MAX_PENDING = 35;

export type DailyFlags = { first: boolean; daily: true; weekly: boolean; monthly: boolean };

export const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);

export function isoWeekMonday(day: string) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

const validDay = (day: unknown): day is string => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day));

export function dailyFlags(lastDay: string | null, today: string, existingInstall: boolean): DailyFlags | null {
  const last = validDay(lastDay) ? lastDay : null;
  if (last !== null && today <= last) return null;
  return {
    first: last === null && !existingInstall,
    daily: true,
    weekly: last === null || isoWeekMonday(last) !== isoWeekMonday(today),
    monthly: last === null || last.slice(0, 7) !== today.slice(0, 7),
  };
}

export const retryDelay = (failures: number) => Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.max(0, failures - 1));

export function nextCheckDelay(now: number, jitter = Math.random()) {
  const midnight = Date.parse(`${utcDay(now)}T00:00:00Z`) + 86_400_000;
  return Math.min(RECHECK_MS, midnight - now + Math.floor(jitter * MIDNIGHT_JITTER_MS));
}

export type PendingPing = { day: string; id: string; timestamp: string; properties: Record<string, unknown> };
type DailyState = { lastDay: string | null; pending: PendingPing[] };

const validPending = (p: unknown): p is PendingPing => {
  const v = p as PendingPing | null;
  return !!v && validDay(v.day) && typeof v.id === "string" && !!v.id && typeof v.timestamp === "string" && typeof v.properties === "object" && v.properties !== null;
};

export function readDailyState(): DailyState {
  try {
    const stored = JSON.parse(readDocument(DAILY_DOC) ?? "null") as { lastDay?: unknown; pending?: unknown } | null;
    return {
      lastDay: validDay(stored?.lastDay) ? stored.lastDay : null,
      pending: Array.isArray(stored?.pending) ? stored.pending.filter(validPending) : [],
    };
  } catch {
    return { lastDay: null, pending: [] };
  }
}

export const readLastDay = () => readDailyState().lastDay;

let unsaved = false;

async function saveDailyState(state: DailyState): Promise<boolean> {
  try {
    await saveDocument(DAILY_DOC, JSON.stringify({ version: 1, ...state }));
    unsaved = false;
    return true;
  } catch {
    unsaved = true;
    return false;
  }
}

const allowedToSend = () => launchEnvironment(DEV_SEND_ENV) === "1" || (!__DEV__ && appInfo().isolatedInstance === false);

async function updateChannel(): Promise<string | null> {
  try {
    const state = await updaterState();
    return state.available ? (state.channel ?? state.buildChannel ?? null) : null;
  } catch {
    return null;
  }
}

export function dailyProperties(flags: DailyFlags, channel: string | null): Record<string, unknown> {
  const info = appInfo();
  return {
    $lib: DAILY_LIB,
    $lib_version: "1",
    $app_name: "Ardia",
    $app_version: info.appVersion,
    $os: "macOS",
    os_major: (info.osVersion ?? "").split(".")[0] || null,
    arch: info.arch,
    channel,
    $environment: environment(),
    $process_person_profile: false,
    $geoip_disable: true,
    ...flags,
  };
}

export function dailyBody(id: string, timestamp: string, properties: Record<string, unknown>) {
  const info = appInfo();
  const resource = {
    "service.name": "ardia-app",
    "service.version": info.appVersion,
    "deployment.environment": environment() === "production" ? "production" : "development",
  };
  return logsRequest(resource, EVENTS_SCOPE, [eventRecord({ uuid: id, event: DAILY_EVENT, distinct_id: id, timestamp, properties })]);
}

let existingInstall = true;
let failures = 0;
let sending = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let nextAt = 0;

async function post(body: string): Promise<number> {
  const entry: RequestLogEntry = { at: new Date().toISOString(), kind: "daily", url: LOGS_URL, count: 1, bytes: body.length, status: null };
  if (!allowedToSend()) {
    logRequest({ ...entry, dryRun: true }, body);
    return 200;
  }
  try {
    const response = await fetch(LOGS_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    entry.status = response.status;
  } catch {
    entry.status = 0;
  }
  logRequest(entry, body);
  return entry.status;
}

export async function sendDailyPing(now = Date.now()): Promise<"sent" | "already" | "failed" | "busy"> {
  if (sending) return "busy";
  sending = true;
  try {
    const today = utcDay(now);
    let state = readDailyState();
    const flags = dailyFlags(state.lastDay, today, existingInstall);
    if (flags) {
      const observed = { day: today, id: uuidv4(), timestamp: new Date(now).toISOString(), properties: dailyProperties(flags, await updateChannel()) };
      state = { lastDay: today, pending: [...state.pending, observed].slice(-MAX_PENDING) };
      if (!(await saveDailyState(state))) return (failures++, "failed");
    } else if (unsaved && !(await saveDailyState(state))) return (failures++, "failed");
    if (!state.pending.length) return (failures = 0, "already");
    let sent = false;
    for (const ping of [...state.pending].sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
      const result = outcome(await post(dailyBody(ping.id, ping.timestamp, ping.properties)), 1);
      if (result === "retry" || result === "split") return (failures++, "failed");
      sent ||= result === "sent";
      const current = readDailyState();
      await saveDailyState({ lastDay: current.lastDay, pending: current.pending.filter((p) => p.id !== ping.id) });
    }
    failures = 0;
    return sent ? "sent" : "failed";
  } finally {
    sending = false;
  }
}

function schedule(delay: number) {
  clearTimeout(timer);
  nextAt = Date.now() + delay;
  timer = setTimeout(() => void tick(), delay);
}

async function tick() {
  const result = await sendDailyPing();
  schedule(result === "failed" && failures > 0 ? retryDelay(failures) : nextCheckDelay(Date.now()));
}

export function startDaily(installedBefore: boolean) {
  existingInstall = installedBefore;
  schedule(FIRST_PING_DELAY_MS);
}

export const devDaily = () => ({ ...readDailyState(), existingInstall, failures, nextAt: nextAt ? new Date(nextAt).toISOString() : null, allowed: allowedToSend() });

export function resetDailyForTests(installedBefore = false) {
  clearTimeout(timer);
  existingInstall = installedBefore;
  failures = 0;
  sending = false;
  nextAt = 0;
}
