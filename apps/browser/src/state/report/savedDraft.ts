import { isFields, isNumber, isString, isStringList, type Fields } from "../../lib/decode";
import { parseSaved, versionedJson, type Migrations } from "../../lib/savedDocument";
import type { ReportIdentity } from "../telemetry/identity";
import { DEFAULT_ATTACH, REPORT_KINDS, emptyDraft, type AttachmentKey, type ReportDraft } from "./form";
import type { Recording, ReportSheetState, Trace } from "./store";
import { failureMessage, type Created, type FailedStage, type FailureClass, type UploadState } from "./upload";

export const SAVED_DRAFT_DOC = "report-draft.json";
const VERSION = 1;
const MIGRATIONS: Migrations = {};

type ReadyRecording = Extract<Recording, { phase: "ready" }>;
type ReadyTrace = Extract<Trace, { phase: "ready" }>;
type Pending = { stage: FailedStage; errorClass: FailureClass; status: number; created: Created | null };

export type SavedDraft = {
  draft: ReportDraft;
  draftDir: string | null;
  recording: ReadyRecording | null;
  trace: ReadyTrace | null;
  pending: Pending | null;
  identity: ReportIdentity | null;
};

export type Restored = Pick<ReportSheetState, "draft" | "draftDir" | "recording" | "trace" | "upload"> & { identity: ReportIdentity | null };

export function savedDraftOf(s: ReportSheetState, identity: ReportIdentity | null): SavedDraft | null {
  if (s.sent) return null;
  const recording = s.recording.phase === "ready" ? s.recording : null;
  const trace = s.trace.phase === "ready" ? s.trace : null;
  const failed = s.upload.phase === "failed" ? s.upload : null;
  const pending = failed ? { stage: failed.stage, errorClass: failed.errorClass, status: failed.status, created: failed.created } : null;
  const draft = s.draft;
  const blank = !draft.title.trim() && !draft.description.trim() && !draft.contact.trim();
  if (blank && !recording && !trace && !pending) return null;
  return { draft, draftDir: s.draftDir, recording, trace, pending, identity: pending?.created ? identity : null };
}

export const savedDraftJson = (saved: SavedDraft) => versionedJson(saved, VERSION);

const KINDS = new Set<string>(REPORT_KINDS.map((k) => k.value));
const STAGES = new Set<string>(["create", "upload", "complete"]);
const CLASSES = new Set<string>(["offline", "storage", "server", "rate_limited", "expired", "rejected"]);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const str = (v: unknown) => (isString(v) ? v : "");

function draftFrom(v: unknown): ReportDraft | null {
  if (!isFields(v) || !isString(v.kind) || !KINDS.has(v.kind)) return null;
  const base = emptyDraft();
  const attach = isFields(v.attach) ? v.attach : {};
  const keys = Object.keys(DEFAULT_ATTACH) as AttachmentKey[];
  return {
    kind: v.kind as ReportDraft["kind"],
    title: str(v.title),
    description: str(v.description),
    contact: str(v.contact),
    includePages: bool(v.includePages, base.includePages),
    trace: bool(v.trace, base.trace),
    attach: Object.fromEntries(keys.map((key) => [key, bool(attach[key], DEFAULT_ATTACH[key])])) as Record<AttachmentKey, boolean>,
    watch: bool(v.watch, base.watch),
  };
}

function recordingFrom(v: unknown, exists: (path: string) => boolean): ReadyRecording | null {
  if (!isFields(v) || !isString(v.path) || !isNumber(v.seconds) || !isNumber(v.bytes) || !exists(v.path)) return null;
  const thumbnail = isString(v.thumbnail) && exists(v.thumbnail) ? v.thumbnail : null;
  return { phase: "ready", path: v.path, thumbnail, seconds: v.seconds, bytes: v.bytes, includePages: bool(v.includePages, false) };
}

function traceFrom(v: unknown, exists: (path: string) => boolean): ReadyTrace | null {
  if (!isFields(v) || !isString(v.path) || !isNumber(v.bytes) || !isNumber(v.seconds) || !exists(v.path)) return null;
  return { phase: "ready", path: v.path, bytes: v.bytes, seconds: v.seconds };
}

function createdFrom(v: unknown): Created | null {
  if (!isFields(v) || !isString(v.id) || !isString(v.token) || !isFields(v.uploadUrls) || !isStringList(v.uploaded)) return null;
  const urls = Object.fromEntries(Object.entries(v.uploadUrls).filter((entry): entry is [string, string] => isString(entry[1])));
  return { id: v.id, name: isString(v.name) ? v.name : null, token: v.token, uploadUrls: urls, uploaded: v.uploaded };
}

function identityFrom(v: unknown): ReportIdentity | null {
  if (!isFields(v) || !isString(v.id) || !isString(v.name) || (v.kind !== "install" && v.kind !== "one-time") || !isFields(v.avatar)) return null;
  return v as unknown as ReportIdentity;
}

function pendingFrom(v: unknown): UploadState {
  if (!isFields(v) || !isString(v.stage) || !STAGES.has(v.stage) || !isString(v.errorClass) || !CLASSES.has(v.errorClass)) return { phase: "idle" };
  const errorClass = v.errorClass as FailureClass;
  const status = isNumber(v.status) ? v.status : 0;
  return {
    phase: "failed",
    stage: v.stage as FailedStage,
    errorClass,
    status,
    created: createdFrom(v.created),
    attempts: 0,
    message: failureMessage(errorClass, status, null),
  };
}

export function restoredDraft(json: string | null, exists: (path: string) => boolean): Restored | null {
  const saved: Fields | null = parseSaved(json, VERSION, MIGRATIONS);
  const draft = saved ? draftFrom(saved.draft) : null;
  if (!saved || !draft) return null;
  const recording = recordingFrom(saved.recording, exists);
  const trace = traceFrom(saved.trace, exists);
  const upload = pendingFrom(saved.pending);
  return {
    draft,
    draftDir: isString(saved.draftDir) ? saved.draftDir : null,
    recording: recording ?? { phase: "none" },
    trace: trace ?? { phase: "none" },
    upload,
    identity: upload.phase === "failed" && upload.created ? identityFrom(saved.identity) : null,
  };
}
