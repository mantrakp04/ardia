import { engineInfo, updaterState } from "../../platform/app";
import { readDocument, saveDocument, writeDocument } from "../../platform/documents";
import { MAX_BODY_BYTES } from "./config";
import { EVENTS_SCOPE, eventRecord, LOGS_SCOPE, logRecord, logsRequest, outcome, type OtlpLogRecord, type QueuedEvent } from "./otlp";
import { cleanProperties } from "./sanitize";
import type { SavedContext } from "./savedContext";
import type { RequestLogEntry } from "./requestLog";
import { appInfo, mayPost, post } from "./transport";
import { uuidv4, uuidv7 } from "./ids";
import { parseSaved, versionedJson } from "../../lib/savedDocument";
import { withDeadline } from "../../lib/deadline";
import { isFields, isString } from "../../lib/decode";
import { dismissAsk, isSharing, loadChoice, NO_WATCH, save, savedChoice as saved, sessionId, startNewSession, useTelemetry } from "./choice";
import { flushLocalNow, LOCAL_KEEP_DAYS, recordLocal } from "./localStore";

const QUEUE_DOC = "telemetry-queue.json";
const QUEUE_VERSION = 1;

const MAX_EVENTS = 1000;
const MAX_LOGS = 200;
const BATCH_SIZE = 100;
const FLUSH_DELAY_MS = 30_000;
const URGENT_FLUSH_DELAY_MS = 3_000;
const MAX_BACKOFF_MS = 30 * 60_000;

export { dismissAsk, isSharing, loadChoice, useTelemetry };

let engineVersion: string | null = null;

export const environment = (): "dev" | "test" | "production" =>
  __DEV__ ? "dev" : appInfo().isolatedInstance ? "test" : "production";

function context(): Record<string, unknown> {
  const info = appInfo();
  return {
    $lib: "ardia-telemetry",
    $lib_version: "1",
    $app_name: "Ardia",
    $app_version: info.appVersion,
    $app_build: info.appBuild,
    $os: "macOS",
    $os_version: info.osVersion,
    arch: info.arch,
    engine_version: engineVersion,
    $environment: environment(),
    $process_person_profile: false,
    $geoip_disable: true,
    $session_id: sessionId(),
    ...watchProperty(),
  };
}

function watchProperty(): Record<string, string> {
  const { watchReport, watchUntil } = saved();
  return watchReport && watchUntil !== null && Date.now() < watchUntil ? { watch_report: watchReport } : {};
}

type Queue = { events: QueuedEvent[]; logs: OtlpLogRecord[] };

let queue: Queue = { events: [], logs: [] };
let queueLoaded = false;
let generation = 0;

const isEvent = (v: unknown): v is QueuedEvent =>
  isFields(v) && isString(v.uuid) && isString(v.event) && isString(v.distinct_id) && isString(v.timestamp) && isFields(v.properties);
const isLog = (v: unknown): v is OtlpLogRecord => isFields(v) && isString(v.timeUnixNano) && isFields(v.body) && Array.isArray(v.attributes);

function storedQueue(): Queue {
  const doc = parseSaved(readDocument(QUEUE_DOC), QUEUE_VERSION);
  return {
    events: Array.isArray(doc?.events) ? doc.events.filter(isEvent) : [],
    logs: Array.isArray(doc?.logs) ? doc.logs.filter(isLog) : [],
  };
}

function loadQueue() {
  if (queueLoaded) return;
  queueLoaded = true;
  const stored = storedQueue();
  queue = { events: [...stored.events, ...queue.events], logs: [...stored.logs, ...queue.logs] };
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
let queueChars = 0;
export const queuedChars = () => queueChars;
function persistQueue(now = false) {
  clearTimeout(persistTimer);
  persistTimer = undefined;
  const write = () => {
    try {
      loadQueue();
      const json = versionedJson(queue, QUEUE_VERSION);
      queueChars = json.length;
      writeDocument(QUEUE_DOC, json);
    } catch {}
  };
  if (now) write();
  else persistTimer = setTimeout(write, 2000);
}

export function saveQueueNow(timeoutMs = 1000): Promise<void> {
  try {
    flushLocalNow();
  } catch {}
  if (!saved().sharing) return Promise.resolve();
  clearTimeout(persistTimer);
  persistTimer = undefined;
  try {
    loadQueue();
    const landed = saveDocument(QUEUE_DOC, versionedJson(queue, QUEUE_VERSION)).catch(() => {});
    return withDeadline(landed, timeoutMs, undefined);
  } catch {
    return Promise.resolve();
  }
}

function clearQueue() {
  queue = { events: [], logs: [] };
  queueLoaded = true;
  clearTimeout(flushTimer);
  flushTimer = undefined;
  persistQueue(true);
}

let droppedWhileOff = 0;

export type CaptureOptions = {
  raw?: Record<string, unknown>;
  urgent?: boolean;
  persist?: boolean;
};

export function capture(event: string, props: Record<string, unknown> = {}, options: CaptureOptions = {}) {
  try {
    const { sharing, installId } = saved();
    const at = Date.now();
    const record: QueuedEvent = {
      uuid: uuidv7(),
      event,
      distinct_id: installId ?? "",
      timestamp: new Date(at).toISOString(),
      properties: { ...context(), ...cleanProperties(props), ...options.raw },
    };
    recordLocal("event", sharing, { event, uuid: record.uuid, distinct_id: sharing ? installId : null, properties: record.properties }, at);
    if (!sharing) {
      droppedWhileOff++;
      return;
    }
    loadQueue();
    queue.events.push(record);
    if (queue.events.length > MAX_EVENTS) queue.events.splice(0, queue.events.length - MAX_EVENTS);
    persistQueue(options.persist);
    scheduleFlush(options.urgent ? URGENT_FLUSH_DELAY_MS : FLUSH_DELAY_MS);
  } catch {}
}

export function queueLog(level: "warn" | "error", message: string, attributes: Record<string, string | number | boolean>) {
  try {
    const sharing = saved().sharing;
    const at = Date.now();
    const withSession = { ...attributes, $session_id: sessionId() };
    recordLocal("log", sharing, { level, message, attributes: withSession }, at);
    if (!sharing) return;
    loadQueue();
    queue.logs.push(logRecord(level, message, withSession, at));
    if (queue.logs.length > MAX_LOGS) queue.logs.splice(0, queue.logs.length - MAX_LOGS);
    persistQueue();
    scheduleFlush(FLUSH_DELAY_MS);
  } catch {}
}

let flushTimer: ReturnType<typeof setTimeout> | undefined;
let flushDueAt = 0;
let flushing = false;
let failures = 0;
let retryAt = 0;

function scheduleFlush(delay: number) {
  if (!saved().sharing) return;
  const due = Math.max(Date.now() + delay, retryAt);
  if (flushTimer && flushDueAt <= due) return;
  clearTimeout(flushTimer);
  flushDueAt = due;
  flushTimer = setTimeout(() => void flush(), due - Date.now());
}

const inflight = new Set<AbortController>();

async function send(kind: RequestLogEntry["kind"], body: string, count: number) {
  const abort = new AbortController();
  inflight.add(abort);
  try {
    return await post(kind, body, count, abort.signal);
  } finally {
    inflight.delete(abort);
  }
}

function resource(): Record<string, unknown> {
  const info = appInfo();
  return {
    "service.name": "ardia-app",
    "service.version": info.appVersion,
    "deployment.environment": environment() === "production" ? "production" : "development",
    "os.type": "darwin",
    "os.version": info.osVersion,
    "host.arch": info.arch,
    "engine.version": engineVersion,
  };
}

const eventsBody = (batch: QueuedEvent[]) =>
  logsRequest(
    resource(),
    EVENTS_SCOPE,
    batch.map((e) => eventRecord(e.properties.engine_version == null && engineVersion ? { ...e, properties: { ...e.properties, engine_version: engineVersion } } : e)),
  );

const logsBody = (batch: OtlpLogRecord[]) => logsRequest(resource(), LOGS_SCOPE, batch);

type DrainResult = "done" | "failed" | "stale";

async function drain<T>(
  kind: RequestLogEntry["kind"],
  take: () => T[],
  encode: (batch: T[]) => string,
  remove: (batch: T[]) => void,
  gen: number,
): Promise<DrainResult> {
  let size = BATCH_SIZE;
  for (let batch = take().slice(0, size); batch.length; batch = take().slice(0, size)) {
    const body = encode(batch);
    if (body.length > MAX_BODY_BYTES && batch.length > 1) {
      size = Math.ceil(batch.length / 2);
      continue;
    }
    const status = await send(kind, body, batch.length);
    if (gen !== generation) return "stale";
    const result = outcome(status, batch.length);
    if (result === "retry") return "failed";
    if (result === "split") size = Math.ceil(batch.length / 2);
    else remove(batch);
  }
  return "done";
}

export async function flush() {
  flushTimer = undefined;
  if (!saved().sharing || flushing) return;
  flushing = true;
  const gen = generation;
  let result: DrainResult;
  try {
    result = await drain("events", () => queue.events, eventsBody, (batch) => (queue.events = queue.events.filter((e) => !batch.includes(e))), gen);
    if (result === "done") result = await drain("logs", () => queue.logs, logsBody, (batch) => (queue.logs = queue.logs.filter((l) => !batch.includes(l))), gen);
  } finally {
    flushing = false;
  }
  if (result === "stale") return;
  persistQueue(true);
  if (result === "failed") {
    failures++;
    retryAt = Date.now() + Math.min(MAX_BACKOFF_MS, 30_000 * 2 ** (failures - 1));
    scheduleFlush(0);
  } else {
    failures = 0;
    retryAt = 0;
  }
}

export type SharingSource = "settings" | "onboarding" | "ask" | "watch" | "watch_ended";

export type AskPlacement = { ask_place: "new_tab_corner"; ask_shown_tabs: number };

export function setSharing(on: boolean, source: SharingSource, placement?: AskPlacement) {
  const now = Date.now();
  const current = saved();
  if (on === current.sharing) return save({ decidedAt: now, askDoneAt: current.askDoneAt ?? now });
  generation++;
  failures = 0;
  retryAt = 0;
  if (!on) {
    for (const abort of inflight) abort.abort();
    inflight.clear();
    save({ sharing: false, installId: current.installId, context: null, decidedAt: now, askDoneAt: current.askDoneAt ?? now, ...NO_WATCH, watchEndedNotice: current.watchEndedNotice });
    clearQueue();
    capture("sharing_turned_off", { source });
    return;
  }
  save({
    sharing: true,
    installId: current.installId ?? uuidv4(),
    crashCursor: now,
    lastVersion: appInfo().appVersion,
    lastBuild: appInfo().appBuild,
    settingsDay: null,
    sessionOpen: true,
    decidedAt: now,
    askDoneAt: current.askDoneAt ?? now,
  });
  capture("sharing_turned_on", { source, ...placement });
}

export function ensureInstallId(): string {
  const current = saved();
  if (current.installId) return current.installId;
  const installId = uuidv4();
  save({ sharing: false, installId });
  return installId;
}

export function replaceInstallId(): string {
  const current = saved();
  const installId = uuidv4();
  generation++;
  for (const abort of inflight) abort.abort();
  inflight.clear();
  const session = startNewSession();
  const keepsSharing = current.sharing && current.sharingUntil === null;
  if (keepsSharing) save({ sharing: true, installId, sessionId: current.sessionId ? session : null, context: null, ...NO_WATCH });
  else save({ sharing: false, installId, sessionId: current.sessionId ? session : null, context: null, ...NO_WATCH });
  clearQueue();
  return installId;
}

type PreviousSession = "clean" | "unclean" | "none";

type ClientSession = {
  previous: PreviousSession;
  updatedFrom: string | null;
  lastLaunchAt: number | null;
  lastQuitAt: number | null;
  firstOfVersion: boolean;
  context: SavedContext | null;
};

export function startClient(): ClientSession {
  loadChoice();
  void engineInfo()
    .then((e) => (engineVersion = `ArdiaCore / Chromium ${e.chromiumVersion}`))
    .catch(() => {});
  void updaterState()
    .then((u) => {
      const channel = u.available ? (u.channel ?? u.buildChannel ?? null) : null;
      if (channel !== saved().channel) save({ channel });
    })
    .catch(() => {});
  const current = saved();
  if (current.sharing) loadQueue();
  else {
    const stale = storedQueue();
    if (stale.events.length || stale.logs.length) clearQueue();
  }
  const previous: PreviousSession = current.lastVersion === null ? "none" : current.sessionOpen ? "unclean" : "clean";
  const version = appInfo().appVersion;
  const updatedFrom = current.lastVersion && current.lastVersion !== version ? current.lastVersion : null;
  const build = appInfo().appBuild;
  const firstOfVersion = current.lastVersion !== version || (current.lastBuild != null && current.lastBuild !== build);
  const last = { lastLaunchAt: current.lastLaunchAt, lastQuitAt: current.lastQuitAt, firstOfVersion, context: current.context };
  const crashFloor = Date.now() - LOCAL_KEEP_DAYS * 86_400_000;
  save({
    sessionOpen: true,
    sessionId: sessionId(),
    lastVersion: version,
    lastBuild: build,
    lastLaunchAt: appInfo().processStart ?? Date.now(),
    ...(!current.sharing && current.crashCursor < crashFloor ? { crashCursor: crashFloor } : {}),
  });
  scheduleFlush(previous === "unclean" ? 2_000 : 10_000);
  return { previous, updatedFrom, ...last };
}

export function endSession() {
  save({ sessionOpen: false, sessionId: null, lastQuitAt: Date.now() });
  if (saved().sharing) persistQueue(true);
  try {
    flushLocalNow();
  } catch {}
}

export const settingsSnapshotDay = () => saved().settingsDay;
export const markSettingsSnapshot = (day: string) => save({ settingsDay: day });
export const saveContext = (context: SavedContext | null) => saved().sharing && save({ context });

export const crashCursor = () => saved().crashCursor;
export const advanceCrashCursor = (to: number) => to > saved().crashCursor && save({ crashCursor: to });

export const devState = () => ({ saved: saved(), queued: { events: queue.events.length, logs: queue.logs.length }, droppedWhileOff, canSend: mayPost("events") });
