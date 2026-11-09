import { appendLocal, appendLocalNow, clearLocal, configureLocal, exportLocalForReport, exportLocalToDownloads, pruneLocal, type TelemetryLocalExport, type TelemetryLocalStats } from "../../platform/telemetryLocal";

export const LOCAL_MAX_BYTES = 8 * 1_048_576;
export const LOCAL_KEEP_DAYS = 7;
export const LOCAL_FLUSH_MS = 10_000;
const MAX_BUFFER_LINES = 2_000;
const MAX_BUFFER_CHARS = 1_000_000;
export const MAX_LINE_CHARS = 256_000;
const MAX_FLUSH_SAMPLES = 1_000;

const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);

type Pending = { day: string; line: string };

let buffer: Pending[] = [];
let bufferChars = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let configured = false;

const meter = { lines: 0, chars: 0, oversize: 0, flushes: 0, flushMs: [] as number[], bufferedMax: 0, failures: 0 };

export type LocalKind = "event" | "log";

function ensureConfigured() {
  if (configured) return;
  configured = true;
  try {
    configureLocal(LOCAL_MAX_BYTES, LOCAL_KEEP_DAYS);
  } catch {
    meter.failures++;
  }
}

export function recordLocal(kind: LocalKind, sent: boolean, fields: Record<string, unknown>, at = Date.now()) {
  let line: string;
  try {
    line = JSON.stringify(Object.assign({ at, kind, sent }, fields, { at }));
  } catch {
    meter.oversize++;
    return;
  }
  if (line.length > MAX_LINE_CHARS) {
    meter.oversize++;
    return;
  }
  buffer.push({ day: utcDay(at), line: `${line}\n` });
  bufferChars += line.length + 1;
  meter.lines++;
  meter.chars += line.length + 1;
  if (buffer.length > meter.bufferedMax) meter.bufferedMax = buffer.length;
  if (buffer.length >= MAX_BUFFER_LINES || bufferChars >= MAX_BUFFER_CHARS) flushLocal();
  else timer ??= setTimeout(flushLocal, LOCAL_FLUSH_MS);
}

function drain(write: (day: string, text: string) => void) {
  clearTimeout(timer);
  timer = undefined;
  if (!buffer.length) return;
  const started = Date.now();
  const pending = buffer;
  buffer = [];
  bufferChars = 0;
  ensureConfigured();
  const byDay = new Map<string, string[]>();
  for (const { day, line } of pending) {
    const lines = byDay.get(day);
    if (lines) lines.push(line);
    else byDay.set(day, [line]);
  }
  for (const [day, lines] of byDay) {
    try {
      write(day, lines.join(""));
    } catch {
      meter.failures++;
    }
  }
  meter.flushes++;
  if (meter.flushMs.length < MAX_FLUSH_SAMPLES) meter.flushMs.push(Date.now() - started);
}

export const flushLocal = () => drain(appendLocal);

export const flushLocalNow = () => drain(appendLocalNow);

export type LocalStoreReading = TelemetryLocalStats & { recorded: number; recordedChars: number; oversize: number; flushes: number; flushMs: number[]; bufferedMax: number; failures: number };

let carried = { writeMs: [] as number[], droppedLines: 0 };

export async function pruneLocalStore(now = Date.now(), take = true): Promise<LocalStoreReading | null> {
  flushLocal();
  ensureConfigured();
  const stats = await pruneLocal(now).catch(() => null);
  if (!stats) return null;
  const writeMs = [...carried.writeMs, ...stats.writeMs].slice(-MAX_FLUSH_SAMPLES * 4);
  const droppedLines = carried.droppedLines + stats.droppedLines;
  if (!take) {
    carried = { writeMs, droppedLines };
    return null;
  }
  carried = { writeMs: [], droppedLines: 0 };
  const reading = { ...stats, writeMs, droppedLines, recorded: meter.lines, recordedChars: meter.chars, oversize: meter.oversize, flushes: meter.flushes, flushMs: meter.flushMs, bufferedMax: meter.bufferedMax, failures: meter.failures };
  Object.assign(meter, { lines: 0, chars: 0, oversize: 0, flushes: 0, flushMs: [], bufferedMax: buffer.length, failures: 0 });
  return reading;
}

export function localEventsSince(ms: number): Promise<TelemetryLocalExport | null> {
  flushLocal();
  return exportLocalForReport(ms).catch(() => null);
}

export function exportLocalCopy(now = Date.now()): Promise<TelemetryLocalExport | null> {
  flushLocal();
  return exportLocalToDownloads(now).catch(() => null);
}

export function clearLocalCopy(): Promise<void> {
  buffer = [];
  bufferChars = 0;
  clearTimeout(timer);
  timer = undefined;
  return clearLocal().catch(() => {});
}

export const devLocalStore = () => ({ buffered: buffer.length, bufferChars, ...meter, flushMs: meter.flushMs.length });
