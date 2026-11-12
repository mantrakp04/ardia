import { beginTracing, endTracing, isTracing } from "../../platform/performance";
import {
  cancelWindowRecording,
  draftDirectory,
  gzipFile,
  onReportEvent,
  recordingThumbnail,
  removeReportFile,
  startWindowRecording,
  stopWindowRecording,
  type RecordingResult,
} from "../../platform/report";
import { RECORDING_MAX_SECONDS, TRACE_MAX_SECONDS } from "./form";
import { currentReport, patchReport } from "./store";
import { useBrowser } from "../browser/store";

let subscribed = false;
let traceTimer: ReturnType<typeof setTimeout> | undefined;
let traceStartedAt = 0;
let lastResult: RecordingResult | null = null;

export const lastRecordingStats = () => lastResult;

export const recordedPictureInPicture = (result: RecordingResult | null) =>
  !!result?.windows?.some((w) => w.kind === "pictureInPicture" && w.frames > 0);

export function ensureDraftDir(): string {
  const dir = currentReport().draftDir;
  if (dir) return dir;
  const made = draftDirectory();
  patchReport({ draftDir: made });
  return made;
}

function listen() {
  if (subscribed) return;
  subscribed = true;
  onReportEvent((event) => {
    if (event.type === "tick") {
      const r = currentReport().recording;
      if (r.phase === "recording") patchReport({ recording: { ...r, seconds: event.seconds } });
      if (currentReport().trace.phase === "tracing" && event.seconds >= TRACE_MAX_SECONDS) void finishTrace();
    } else if (event.type === "stopped") void recordingStopped(event.result);
  });
}

async function recordingStopped(result: RecordingResult | null) {
  void finishTrace();
  const r = currentReport().recording;
  lastResult = result;
  if (!result) return patchReport({ recording: { phase: "failed", message: "The recording couldn't be saved." } });
  const thumbnail = `${ensureDraftDir()}/recording-${Date.now()}.png`;
  const made = await recordingThumbnail(result.path, thumbnail).catch(() => false);
  const pictureInPicture = recordedPictureInPicture(result);
  patchReport({
    recording: {
      phase: "ready",
      path: result.path,
      thumbnail: made ? thumbnail : null,
      seconds: result.seconds,
      bytes: result.bytes,
      includePages: result.includePages,
      pictureInPicture,
      withheldWindows: result.withheldWindows ?? 0,
    },
  });
}

export async function startRecording() {
  const s = currentReport();
  if (!s.windowId || s.recording.phase === "starting" || s.recording.phase === "recording" || s.recording.phase === "saving") return;
  listen();
  discardRecording();
  const includePages = s.draft.includePages && useBrowser.getState().windows[s.windowId]?.kind !== "private";
  patchReport({ recording: { phase: "starting" }, attachedOpen: false, preview: false });
  const path = `${ensureDraftDir()}/recording.mp4`;
  if (s.draft.kind === "slow" && s.draft.trace) await startTrace();
  const started = await startWindowRecording(s.windowId, includePages, path, RECORDING_MAX_SECONDS).catch(() => false);
  if (!started) {
    void finishTrace();
    return patchReport({ recording: { phase: "failed", message: "Ardia couldn't record this window." } });
  }
  patchReport({ recording: { phase: "recording", seconds: 0, includePages } });
}

export async function stopRecording() {
  const r = currentReport().recording;
  if (r.phase !== "recording") return;
  patchReport({ recording: { phase: "saving", includePages: r.includePages } });
  if (!(await stopWindowRecording().catch(() => false))) patchReport({ recording: { phase: "failed", message: "The recording couldn't be saved." } });
}

export function discardRecording() {
  const r = currentReport().recording;
  if (r.phase === "ready") {
    removeReportFile(r.path);
    if (r.thumbnail) removeReportFile(r.thumbnail);
  }
  if (r.phase === "recording" || r.phase === "starting") void cancelWindowRecording();
  patchReport({ recording: { phase: "none" } });
}

async function startTrace() {
  discardTrace();
  if (await isTracing().catch(() => true)) return patchReport({ trace: { phase: "failed" } });
  const ok = await beginTracing().catch(() => false);
  if (!ok) return patchReport({ trace: { phase: "failed" } });
  traceStartedAt = Date.now();
  patchReport({ trace: { phase: "tracing" } });
  clearTimeout(traceTimer);
  traceTimer = setTimeout(() => void finishTrace(), TRACE_MAX_SECONDS * 1000);
}

async function finishTrace() {
  if (currentReport().trace.phase !== "tracing") return;
  clearTimeout(traceTimer);
  const seconds = Math.min(TRACE_MAX_SECONDS, (Date.now() - traceStartedAt) / 1000);
  patchReport({ trace: { phase: "saving" } });
  const raw = await endTracing(true).catch(() => null);
  if (!raw) return patchReport({ trace: { phase: "failed" } });
  const path = `${ensureDraftDir()}/trace.json.gz`;
  const bytes = await gzipFile(raw, path, true).catch(() => -1);
  if (bytes < 0) {
    removeReportFile(raw);
    return patchReport({ trace: { phase: "failed" } });
  }
  patchReport({ trace: { phase: "ready", path, bytes, seconds } });
}

export function discardTrace() {
  const t = currentReport().trace;
  if (t.phase === "ready") removeReportFile(t.path);
  if (t.phase === "tracing") {
    clearTimeout(traceTimer);
    void endTracing(false).catch(() => null);
  }
  patchReport({ trace: { phase: "none" } });
}
