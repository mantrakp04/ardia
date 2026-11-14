import { create } from "zustand";
import { emptyDraft, type ReportDraft } from "./form";
import type { UploadState } from "./upload";

export type Recording =
  | { phase: "none" }
  | { phase: "starting" }
  | { phase: "recording"; seconds: number; includePages: boolean }
  | { phase: "saving"; includePages: boolean }
  | { phase: "ready"; path: string; thumbnail: string | null; seconds: number; bytes: number; includePages: boolean; pictureInPicture?: boolean; withheldWindows?: number }
  | { phase: "failed"; message: string };

export type Trace = { phase: "none" } | { phase: "tracing" } | { phase: "saving" } | { phase: "ready"; path: string; bytes: number; seconds: number } | { phase: "failed" };

export type LocalEvents = { path: string; bytes: number; lines: number } | null;

export type SentReport = { id: string; issueUrl: string | null; issueNumber: number | null; name: string; avatar: { colors: [string, string, string]; angle: number }; watchUntil: number | null; watchTurnsOff: boolean };

export type ReportSheetState = {
  windowId: string | null;
  source: "menu" | "check_in" | null;
  draft: ReportDraft;
  draftDir: string | null;
  pageAddress: string | null;
  systemLine: string;
  local: LocalEvents;
  recording: Recording;
  trace: Trace;
  upload: UploadState;
  sent: SentReport | null;
  preview: boolean;
  attachedOpen: boolean;
  showProblems: boolean;
};

export const initialReportState = (): ReportSheetState => ({
  windowId: null,
  source: null,
  draft: emptyDraft(),
  draftDir: null,
  pageAddress: null,
  systemLine: "",
  local: null,
  recording: { phase: "none" },
  trace: { phase: "none" },
  upload: { phase: "idle" },
  sent: null,
  preview: false,
  attachedOpen: false,
  showProblems: false,
});

export const useReportSheet = create<ReportSheetState>()(() => initialReportState());

export const currentReport = () => useReportSheet.getState();

export const patchReport = (patch: Partial<ReportSheetState>) => useReportSheet.setState(patch);

export const patchDraft = (patch: Partial<ReportDraft>) => useReportSheet.setState((s) => ({ draft: { ...s.draft, ...patch } }));
