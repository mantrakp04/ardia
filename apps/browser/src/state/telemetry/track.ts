import { capture, isSharing } from "./client";
import { appInfo } from "./transport";
import { launchFirstWindow } from "./journeys";

export type SuggestionType = "history" | "bookmark" | "tab" | "url" | "search" | "calc" | "action" | "create" | "extension" | "provider" | "typed";

type SuggestionLike = { kind: string; tabId?: string; bookmarked?: boolean; visited?: boolean } | undefined;

function suggestionType(s: SuggestionLike): SuggestionType {
  if (!s) return "typed";
  switch (s.kind) {
    case "page":
      return s.tabId ? "tab" : s.bookmarked ? "bookmark" : s.visited ? "history" : "url";
    case "search":
    case "calc":
    case "action":
    case "create":
    case "extension":
    case "provider":
      return s.kind;
    default:
      return "url";
  }
}

export const trackSuggestionChosen = (s: SuggestionLike, inlineCompletion = false) => capture("suggestion_chosen", { type: suggestionType(s), inline_completion: inlineCompletion });

export type CalendarConnectReport = { before: string; after: string; responsible: string; errored: boolean; settingsOpened: boolean; ms: number };

export const trackCalendarConnect = (r: CalendarConnectReport) =>
  capture("calendar_connect", { before: r.before, after: r.after, responsible: r.responsible, errored: r.errored, settings_opened: r.settingsOpened, ms: Math.min(Math.max(0, Math.round(r.ms)), 600_000) });

export const trackSettingsSection = (section: string) => capture("settings_section_opened", { section });

const SAMPLE_EVERY = 5;
const MAX_SAMPLES = 500;
const latency: number[] = [];
let keystrokes = 0;

export function sampleOmniboxLatency(ms: number) {
  if (++keystrokes % SAMPLE_EVERY) return;
  if (ms >= 0 && ms < 10_000 && latency.length < MAX_SAMPLES) latency.push(ms);
}

export const takeOmniboxLatency = () => latency.splice(0);

let firstWindowAt: number | null = null;

export function markFirstWindow() {
  if (firstWindowAt !== null) return;
  firstWindowAt = Date.now();
  const start = appInfo().processStart;
  if (!isSharing() || !start) return;
  if (firstWindowAt - start > 0 && firstWindowAt - start < 10 * 60_000) launchFirstWindow(firstWindowAt);
}

export const devOmniboxSampler = () => ({ keystrokes, pending: latency.length });
