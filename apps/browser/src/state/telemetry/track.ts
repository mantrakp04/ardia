import { capture, isSharing } from "./client";
import { appInfo } from "./transport";
import { launchFirstWindow } from "./journeys";
import type { PanelState } from "../browser/types";

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

export type CommandBarPlacementLabel = "field" | "centred" | "centred_no_field" | "new_tab";

export function commandBarPlacementLabel(panel: Pick<PanelState, "newTab" | "placement">): CommandBarPlacementLabel {
  if (panel.newTab) return "new_tab";
  if (panel.placement === "centred") return "centred";
  if (panel.placement === "centredNoField") return "centred_no_field";
  return "field";
}

export const trackSuggestionChosen = (s: SuggestionLike) => capture("suggestion_chosen", { type: suggestionType(s) });

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

let suggests = { search_suggest_ok: 0, search_suggest_blocked: 0, search_suggest_failed: 0 };

export const noteSearchSuggest = (outcome: "ok" | "blocked" | "failed") => void suggests[`search_suggest_${outcome}`]++;

export const takeSearchSuggests = () => {
  const taken = suggests;
  suggests = { search_suggest_ok: 0, search_suggest_blocked: 0, search_suggest_failed: 0 };
  return taken;
};

let firstWindowAt: number | null = null;

export function markFirstWindow() {
  if (firstWindowAt !== null) return;
  firstWindowAt = Date.now();
  const start = appInfo().processStart;
  if (!isSharing() || !start) return;
  if (firstWindowAt - start > 0 && firstWindowAt - start < 10 * 60_000) launchFirstWindow(firstWindowAt);
}

export const devOmniboxSampler = () => ({ keystrokes, pending: latency.length });
