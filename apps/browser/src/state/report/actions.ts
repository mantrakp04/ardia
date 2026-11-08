import { APP_INGEST_KEY, INGEST_KEY_HEADER } from "@ardia/core";
import { cancelUploads, fileSize, onReportEvent, removeReportFile, uploadFile } from "../../platform/report";
import { feedbackURLOverride } from "../../platform/launchConfig";
import { confirm } from "../../platform/dialogs";
import { openUrls } from "../browser/actions";
import { capture, isSharing } from "../telemetry/client";
import { reportIdentity, telemetryIdentity, type ReportIdentity } from "../telemetry/identity";
import { localEventsSince } from "../telemetry/localStore";
import { startWatch } from "../telemetry/watch";
import { appInfo } from "../telemetry/transport";
import { pageAddressOf, reportDiagnostics, systemLine, updateChannel } from "./details";
import {
  buildPayload,
  canSend,
  clampContact,
  clampDescription,
  clampTitle,
  LOCAL_EVENTS_DAYS,
  watchDays,
  watchEndDate,
  type AttachmentKey,
  type ReportDraft,
  type ReportFile,
  type ReportKind,
} from "./form";
import { discardRecording, discardTrace, lastRecordingStats, startRecording, stopRecording } from "./recording";
import { currentReport, initialReportState, patchDraft, patchReport, useReportSheet } from "./store";
import { isBusy, sendReport, type UploadDeps, type UploadState } from "./upload";

export const FEEDBACK_URL = "https://ardia.dev/api/feedback";
const POST_TIMEOUT_MS = 30_000;

export const feedbackEndpoint = () => feedbackURLOverride() ?? FEEDBACK_URL;

let identity: ReportIdentity | null = null;
let cancelled = false;
const progressHandlers = new Set<(id: string, sent: number) => void>();
let progressSubscribed = false;

export function openReport(windowId: string | null, source: "menu" | "check_in" = "menu") {
  if (!windowId) return;
  const s = currentReport();
  if (s.recording.phase === "recording") return;
  if (s.sent) resetReport();
  patchReport({ windowId, source, pageAddress: pageAddressOf(windowId), systemLine: systemLine(), preview: false, attachedOpen: false });
  capture("report_sheet_opened", { source });
  void refreshLocalEvents();
}

async function refreshLocalEvents() {
  const local = await localEventsSince(Date.now() - LOCAL_EVENTS_DAYS * 86_400_000).catch(() => null);
  if (currentReport().windowId) patchReport({ local: local ? { path: local.path, bytes: local.bytes, lines: local.lines } : null });
}

export async function closeReport() {
  const s = currentReport();
  if (isBusy(s.upload)) {
    const answer = await confirm({
      title: "Stop sending this report?",
      message: "It hasn't finished sending. Your draft stays here if you stop.",
      confirmTitle: "Stop Sending",
      cancelTitle: "Keep Sending",
      windowId: s.windowId ?? undefined,
    });
    if (!answer.confirmed) return;
    cancelled = true;
    cancelUploads();
    patchReport({ upload: { phase: "idle" } });
  }
  if (s.recording.phase === "recording") await stopRecording();
  if (currentReport().sent) return resetReport();
  patchReport({ windowId: null, attachedOpen: false, preview: false });
}

export function resetReport() {
  discardRecording();
  discardTrace();
  const s = currentReport();
  if (s.local) removeReportFile(s.local.path);
  identity = null;
  useReportSheet.setState(initialReportState());
}

export const setKind = (kind: ReportKind) => patchDraft({ kind, trace: kind === "slow" ? currentReport().draft.trace : false });
export const setTitle = (title: string) => patchDraft({ title: clampTitle(title) });
export const setDescription = (description: string) => patchDraft({ description: clampDescription(description) });
export const setContact = (contact: string) => patchDraft({ contact: clampContact(contact) });
export const setIncludePages = (includePages: boolean) => patchDraft({ includePages });
export const setTrace = (trace: boolean) => patchDraft({ trace });
export const setWatch = (watch: boolean) => patchDraft({ watch });
export const setAttach = (key: AttachmentKey, on: boolean) => patchDraft({ attach: { ...currentReport().draft.attach, [key]: on } });
export const setAttachedOpen = (attachedOpen: boolean) => patchReport({ attachedOpen });
export const setPreview = (preview: boolean) => patchReport({ preview, attachedOpen: false });

export function reportFiles(s = currentReport()): ReportFile[] {
  const files: ReportFile[] = [];
  if (s.recording.phase === "ready") files.push({ name: "recording.mp4", path: s.recording.path, bytes: s.recording.bytes, type: "video/mp4" });
  if (s.draft.kind === "slow" && s.trace.phase === "ready") files.push({ name: "trace.json.gz", path: s.trace.path, bytes: s.trace.bytes, type: "application/gzip" });
  if (s.draft.attach.errors && s.local && s.local.lines > 0) files.push({ name: "local-events.jsonl.gz", path: s.local.path, bytes: s.local.bytes, type: "application/gzip" });
  return files.map((f) => ({ ...f, bytes: Math.max(f.bytes, fileSize(f.path)) }));
}

async function postJson(url: string, body: unknown, headers: Record<string, string>) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), POST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: abort.signal });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    return { status: response.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function listenProgress() {
  if (progressSubscribed) return;
  progressSubscribed = true;
  onReportEvent((event) => {
    if (event.type === "upload") for (const handler of progressHandlers) handler(event.id, event.sent);
  });
}

const deps: UploadDeps = {
  postJson,
  putFile: async (id, url, headers, file) => (await uploadFile(id, url, "PUT", { ...headers, "Content-Type": file.type }, file.path)).status,
  onProgress(handler) {
    listenProgress();
    progressHandlers.add(handler);
    return () => void progressHandlers.delete(handler);
  },
  now: () => Date.now(),
};

export async function previewPayload(): Promise<Record<string, unknown>> {
  const s = currentReport();
  return buildPayload(s.draft, await payloadContext(s.draft, identity?.id ?? "<anonymous id, made when you send>"));
}

async function payloadContext(draft: ReportDraft, installId: string) {
  const s = currentReport();
  const info = appInfo();
  return {
    installId,
    sessionId: telemetryIdentity().sessionId,
    appVersion: info.appVersion,
    appBuild: info.appBuild,
    channel: await updateChannel(),
    osVersion: info.osVersion,
    arch: info.arch,
    pageAddress: s.pageAddress,
    sharing: isSharing(),
    diagnostics: await reportDiagnostics(draft, s.local?.lines ?? null),
    files: reportFiles(s),
  };
}

export async function sendCurrentReport() {
  const s = currentReport();
  if (!canSend(s.draft) || isBusy(s.upload) || s.recording.phase === "recording" || s.recording.phase === "saving" || s.trace.phase === "tracing" || s.trace.phase === "saving") return;
  cancelled = false;
  const resume = s.upload.phase === "failed" ? s.upload.created : null;
  const sharing = isSharing();
  identity = resume && identity ? identity : reportIdentity(s.draft.watch && !sharing);
  const files = reportFiles(s);
  const payload = buildPayload(s.draft, await payloadContext(s.draft, identity.id));
  const endpoint = { url: feedbackEndpoint(), key: APP_INGEST_KEY, keyHeader: INGEST_KEY_HEADER };
  const result = await sendReport(deps, endpoint, payload, files, (upload: UploadState) => !cancelled && patchReport({ upload }), resume, () => cancelled);
  if (cancelled) return;
  if (result.phase === "failed") {
    capture("report_failed", { stage: result.stage, kind: s.draft.kind });
    return;
  }
  if (result.phase !== "sent") return;
  const days = watchDays(s.draft, sharing);
  if (days > 0) startWatch(result.sent.id, days);
  const shown = identity;
  patchReport({
    sent: {
      id: result.sent.id,
      issueUrl: result.sent.issueUrl,
      issueNumber: result.sent.issueNumber,
      name: result.sent.name ?? shown.name,
      avatar: shown.avatar,
      watchUntil: days > 0 ? watchEndDate(Date.now(), days) : null,
      watchTurnsOff: !sharing,
    },
  });
  capture("report_sent", {
    kind: s.draft.kind,
    has_recording: files.some((f) => f.name === "recording.mp4"),
    has_trace: files.some((f) => f.name === "trace.json.gz"),
    attachments: files.length,
    watch: days > 0,
    upload_ms: result.sent.uploadMs,
    bytes: result.sent.bytes,
  });
}

export function viewIssue() {
  const s = currentReport();
  if (s.sent?.issueUrl) openUrls([s.sent.issueUrl], s.windowId);
}

export function finishReport() {
  resetReport();
}

if (__DEV__)
  (globalThis as { acReport?: unknown }).acReport = {
    store: useReportSheet,
    setKind,
    setTitle,
    setDescription,
    setContact,
    setIncludePages,
    setTrace,
    setWatch,
    setAttach,
    setAttachedOpen,
    setPreview,
    send: sendCurrentReport,
    close: closeReport,
    reset: resetReport,
    files: () => reportFiles(),
    payload: previewPayload,
    record: startRecording,
    stopRecording,
    discardRecording,
    recordingStats: lastRecordingStats,
  };
