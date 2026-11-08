import { diagnosticsSample, hardwareInfo, type HardwareInfo } from "../../platform/app";
import { systemState } from "../../platform/performance";
import { withDeadline } from "../../lib/deadline";
import { useBrowser } from "../browser/store";
import { capture, isSharing, saveContext, useTelemetry } from "./client";
import type { SavedContext } from "./savedContext";
import { appInfo } from "./transport";

const CONTEXT_EVERY_MS = 10 * 60_000;
const FIRST_CONTEXT_MS = 3_000;
const HARDWARE_WAIT_MS = 1_000;
const MAX_PAGE_PROCESS_EVENTS = 30;
const MINUTE_MS = 60_000;
const MAX_SAMPLES = 12;

const startedAt = Date.now();
export const sessionStart = () => appInfo().processStart ?? startedAt;
let appMemoryMb: number | null = null;
let pageProcessesGone = 0;
let pageProcessEvents = 0;
let samples: SavedContext[] = [];
let firstSample: ReturnType<typeof setTimeout> | undefined;
let everySample: ReturnType<typeof setInterval> | undefined;

const size = (o: object) => Object.keys(o).length;
const sessionMinutes = (at = Date.now()) => Math.max(0, Math.round((at - sessionStart()) / MINUTE_MS));

function counts() {
  const s = useBrowser.getState();
  return { tabs: size(s.tabs), windows: size(s.windows), profiles: size(s.profiles) };
}

async function memoryPressure(): Promise<string | null> {
  const state = await withDeadline(systemState(), HARDWARE_WAIT_MS, null).catch(() => null);
  return state?.memoryPressure ?? null;
}

const roughGigabytes = (gb: number | undefined) => (gb === undefined ? null : gb < 10 ? Math.round(gb * 10) / 10 : Math.round(gb));

export const noteAppMemory = (totalMb: number) => (appMemoryMb = totalMb);

export async function recordContext(): Promise<SavedContext | null> {
  if (!isSharing()) return null;
  const [sample, pressure] = await Promise.all([diagnosticsSample().catch(() => ({ footprintMB: undefined, freeDiskGB: undefined })), memoryPressure()]);
  const now = Date.now();
  const context: SavedContext = {
    at: now,
    session_start: sessionStart(),
    ...counts(),
    footprint_mb: sample.footprintMB ?? null,
    app_memory_mb: appMemoryMb,
    free_disk_gb: roughGigabytes(sample.freeDiskGB),
    memory_pressure: pressure,
    page_processes_gone: pageProcessesGone,
  };
  if (!isSharing()) return null;
  samples = [...samples, context].slice(-MAX_SAMPLES);
  saveContext(context);
  return context;
}

export const contextSamples = () => samples;

function forgetContext() {
  samples = [];
  appMemoryMb = null;
  pageProcessesGone = 0;
}

useTelemetry.subscribe((s, prev) => prev.sharing && !s.sharing && forgetContext());

useBrowser.subscribe((s, prev) => {
  if (s.profiles === prev.profiles || size(s.profiles) >= size(prev.profiles)) return;
  forgetContext();
  saveContext(null);
});

export function startContextSamples() {
  stopContextSamples();
  firstSample = setTimeout(() => void recordContext(), FIRST_CONTEXT_MS);
  everySample = setInterval(() => void recordContext(), CONTEXT_EVERY_MS);
}

export function stopContextSamples() {
  clearTimeout(firstSample);
  clearInterval(everySample);
  firstSample = everySample = undefined;
}

const CONTEXT_FIELDS = ["tabs", "windows", "profiles", "footprint_mb", "app_memory_mb", "free_disk_gb", "memory_pressure", "page_processes_gone"] as const;

export function contextProperties(context: SavedContext | null, prefix: string, at: number): Record<string, unknown> {
  if (!context || typeof context.at !== "number") return {};
  const out: Record<string, unknown> = {};
  for (const key of CONTEXT_FIELDS) out[`${prefix}${key}`] = context[key] ?? null;
  const start = typeof context.session_start === "number" ? context.session_start : null;
  out[`${prefix}session_min`] = start === null ? null : Math.max(0, Math.round((context.at - start) / MINUTE_MS));
  out[`${prefix}age_min`] = Math.max(0, Math.round((at - context.at) / MINUTE_MS));
  return out;
}

const startOf = (c: SavedContext | null) => (c && typeof c.session_start === "number" && typeof c.at === "number" ? c.session_start : null);

export function contextAt(contexts: (SavedContext | null)[], at: number, sessionStarts: number[]): SavedContext | null {
  const starts = [...sessionStarts, ...contexts.map(startOf)].filter((start): start is number => start !== null && start <= at);
  if (!starts.length) return null;
  const session = Math.max(...starts);
  let best: SavedContext | null = null;
  for (const c of contexts) {
    if (startOf(c) !== session || (c!.at as number) > at) continue;
    if (!best || (c!.at as number) > (best.at as number)) best = c;
  }
  return best;
}

const chipName = (chip: string) => chip.split(" @ ", 1)[0]!.replace(/\(R\)|\(TM\)/g, "").replace(/\s+/g, " ").trim();

export async function hardwareProperties(): Promise<Record<string, unknown>> {
  const info: HardwareInfo | null = await withDeadline(hardwareInfo(), HARDWARE_WAIT_MS, null).catch(() => null);
  if (!info) return {};
  return {
    chip: chipName(info.chip) || null,
    gpu: info.gpu ? chipName(info.gpu) : null,
    memory_gb: info.memoryGB,
    displays: info.displays,
    max_scale: Math.round(info.maxScale * 100) / 100,
    hw_decode_av1: info.hardwareDecode.av1,
    hw_decode_vp9: info.hardwareDecode.vp9,
    hw_decode_hevc: info.hardwareDecode.hevc,
    hw_decode_h264: info.hardwareDecode.h264,
  };
}

const GONE_REASONS = new Set(["abnormal", "killed", "crashed", "oom", "launchFailed", "integrity", "unknown"]);

export function trackPageProcessGone(info: { reason: string; code: number }, visible: boolean) {
  if (!isSharing()) return;
  pageProcessesGone++;
  if (pageProcessEvents >= MAX_PAGE_PROCESS_EVENTS) return;
  pageProcessEvents++;
  const reason = GONE_REASONS.has(info.reason) ? info.reason : "unknown";
  const props = {
    process: "renderer",
    reason,
    exit_code: Number.isSafeInteger(info.code) ? info.code : null,
    visible,
    ...counts(),
    session_min: sessionMinutes(),
    gone_this_session: pageProcessesGone,
  };
  void memoryPressure().then((memory_pressure) => capture("page_process_gone", { ...props, memory_pressure }));
}
