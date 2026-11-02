import { engineInfo } from "../../platform/app";
import { readDocument, saveDocument, writeDocument } from "../../platform/documents";
import { create } from "zustand";
import { MAX_BODY_BYTES } from "./config";
import { EVENTS_SCOPE, eventRecord, LOGS_SCOPE, logRecord, logsRequest, outcome, type OtlpLogRecord, type QueuedEvent } from "./otlp";
import { cleanProperties } from "./sanitize";
import type { RequestLogEntry } from "./requestLog";
import { appInfo, mayPost, post } from "./transport";
import { uuidv4, uuidv7 } from "./ids";
import { parseSaved, versionedJson, unchanged, type Migrations, type SavedObject } from "../../lib/savedDocument";
import { withDeadline } from "../../lib/deadline";
import { isFields, isString, numberOr, stringOr } from "../../lib/decode";

const STATE_DOC = "telemetry.json";
const QUEUE_DOC = "telemetry-queue.json";
const STATE_VERSION = 1;
const STATE_MIGRATIONS: Migrations = { 0: unchanged };
const QUEUE_VERSION = 1;

const MAX_EVENTS = 1000;
const MAX_LOGS = 200;
const BATCH_SIZE = 100;
const FLUSH_DELAY_MS = 30_000;
const URGENT_FLUSH_DELAY_MS = 3_000;
const MAX_BACKOFF_MS = 30 * 60_000;

type Session = {
  decidedAt: number | null;
  askDoneAt: number | null;
  crashCursor: number;
  lastVersion: string | null;
  sessionOpen: boolean;
  lastLaunchAt: number | null;
  lastQuitAt: number | null;
  lastBuild: string | null;
  settingsDay: string | null;
};
type Sharing = { sharing: false; installId: null } | { sharing: true; installId: string };
type Saved = Session & Sharing;

const DEFAULT: Saved = {
  sharing: false,
  installId: null,
  decidedAt: null,
  askDoneAt: null,
  crashCursor: 0,
  lastVersion: null,
  sessionOpen: false,
  lastLaunchAt: null,
  lastQuitAt: null,
  lastBuild: null,
  settingsDay: null,
};

function readSaved(doc: SavedObject | null): Saved {
  if (!doc) return DEFAULT;
  const sharing: Sharing = doc.sharing === true && isString(doc.installId) && doc.installId ? { sharing: true, installId: doc.installId } : { sharing: false, installId: null };
  return {
    ...sharing,
    decidedAt: numberOr(doc.decidedAt, null),
    askDoneAt: numberOr(doc.askDoneAt, null),
    crashCursor: numberOr(doc.crashCursor, 0),
    lastVersion: stringOr(doc.lastVersion, null),
    sessionOpen: doc.sessionOpen === true,
    lastLaunchAt: numberOr(doc.lastLaunchAt, null),
    lastQuitAt: numberOr(doc.lastQuitAt, null),
    lastBuild: stringOr(doc.lastBuild, null),
    settingsDay: stringOr(doc.settingsDay, null),
  };
}

let saved: Saved = DEFAULT;

function save(patch: Partial<Session> | (Partial<Session> & Sharing)) {
  saved = { ...saved, ...patch } as Saved;
  try {
    writeDocument(STATE_DOC, versionedJson(saved, STATE_VERSION));
  } catch {}
  useTelemetry.setState({ sharing: saved.sharing, decided: saved.decidedAt !== null, askDone: saved.askDoneAt !== null });
}

export const useTelemetry = create<{ sharing: boolean; decided: boolean; askDone: boolean }>()(() => ({
  sharing: false,
  decided: false,
  askDone: false,
}));

export const isSharing = () => saved.sharing;

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
  };
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
function persistQueue(now = false) {
  clearTimeout(persistTimer);
  persistTimer = undefined;
  const write = () => {
    try {
      loadQueue();
      writeDocument(QUEUE_DOC, versionedJson(queue, QUEUE_VERSION));
    } catch {}
  };
  if (now) write();
  else persistTimer = setTimeout(write, 2000);
}

export function saveQueueNow(timeoutMs = 1000): Promise<void> {
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
  if (!saved.sharing) {
    droppedWhileOff++;
    return;
  }
  try {
    loadQueue();
    queue.events.push({
      uuid: uuidv7(),
      event,
      distinct_id: saved.installId,
      timestamp: new Date().toISOString(),
      properties: { ...context(), ...cleanProperties(props), ...options.raw },
    });
    if (queue.events.length > MAX_EVENTS) queue.events.splice(0, queue.events.length - MAX_EVENTS);
    persistQueue(options.persist);
    scheduleFlush(options.urgent ? URGENT_FLUSH_DELAY_MS : FLUSH_DELAY_MS);
  } catch {}
}

export function queueLog(level: "warn" | "error", message: string, attributes: Record<string, string | number | boolean>) {
  if (!saved.sharing) return;
  try {
    loadQueue();
    queue.logs.push(logRecord(level, message, attributes));
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
  if (!saved.sharing) return;
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
  if (!saved.sharing || flushing) return;
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

type SharingSource = "settings" | "onboarding" | "ask";

export function setSharing(on: boolean, source: SharingSource) {
  const now = Date.now();
  if (on === saved.sharing) return save({ decidedAt: now, askDoneAt: saved.askDoneAt ?? now });
  generation++;
  failures = 0;
  retryAt = 0;
  if (!on) {
    for (const abort of inflight) abort.abort();
    inflight.clear();
    save({ sharing: false, installId: null, sessionOpen: false, decidedAt: now, askDoneAt: saved.askDoneAt ?? now });
    clearQueue();
    return;
  }
  save({
    sharing: true,
    installId: uuidv4(),
    crashCursor: now,
    lastVersion: appInfo().appVersion,
    lastBuild: appInfo().appBuild,
    settingsDay: null,
    sessionOpen: true,
    decidedAt: now,
    askDoneAt: saved.askDoneAt ?? now,
  });
  capture("sharing_turned_on", { source });
}

export const dismissAsk = () => save({ askDoneAt: Date.now() });

type PreviousSession = "clean" | "unclean" | "none";

let loaded = false;

export function loadChoice() {
  if (loaded) return;
  loaded = true;
  saved = readSaved(parseSaved(readDocument(STATE_DOC), STATE_VERSION, STATE_MIGRATIONS));
  useTelemetry.setState({ sharing: saved.sharing, decided: saved.decidedAt !== null, askDone: saved.askDoneAt !== null });
}

type ClientSession = {
  previous: PreviousSession;
  updatedFrom: string | null;
  lastLaunchAt: number | null;
  lastQuitAt: number | null;
  firstOfVersion: boolean;
};

export function startClient(): ClientSession | null {
  loadChoice();
  void engineInfo()
    .then((e) => (engineVersion = `ArdiaCore / Chromium ${e.chromiumVersion}`))
    .catch(() => {});
  if (!saved.sharing) {
    const stale = storedQueue();
    if (stale.events.length || stale.logs.length) clearQueue();
    return null;
  }
  loadQueue();
  const previous: PreviousSession = saved.lastVersion === null ? "none" : saved.sessionOpen ? "unclean" : "clean";
  const version = appInfo().appVersion;
  const updatedFrom = saved.lastVersion && saved.lastVersion !== version ? saved.lastVersion : null;
  const build = appInfo().appBuild;
  const firstOfVersion = saved.lastVersion !== version || (saved.lastBuild != null && saved.lastBuild !== build);
  const last = { lastLaunchAt: saved.lastLaunchAt, lastQuitAt: saved.lastQuitAt, firstOfVersion };
  save({ sessionOpen: true, lastVersion: version, lastBuild: build, lastLaunchAt: appInfo().processStart ?? Date.now() });
  scheduleFlush(10_000);
  return { previous, updatedFrom, ...last };
}

export function endSession() {
  if (!saved.sharing) return;
  save({ sessionOpen: false, lastQuitAt: Date.now() });
  persistQueue(true);
}

export const settingsSnapshotDay = () => saved.settingsDay;
export const markSettingsSnapshot = (day: string) => save({ settingsDay: day });

export const crashCursor = () => saved.crashCursor;
export const advanceCrashCursor = (to: number) => to > saved.crashCursor && save({ crashCursor: to });

export const devState = () => ({ saved, queued: { events: queue.events.length, logs: queue.logs.length }, droppedWhileOff, canSend: mayPost("events") });
