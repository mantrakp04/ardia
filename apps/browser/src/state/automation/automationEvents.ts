import { reportPageCommits } from "../../platform/tabs";
import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId } from "../browser/model";
import { focusedWindowOf } from "../windows/ui";
import { eligibleKind, isEligibleTab, shownPage } from "./automationWindows";

export const AUTOMATION_EVENTS = [
  "window.opened",
  "window.closed",
  "window.focused",
  "tab.opened",
  "tab.closed",
  "tab.activated",
  "tab.navigated",
  "settings.changed",
] as const;
export type AutomationEventName = (typeof AUTOMATION_EVENTS)[number];
export type AutomationEventSink = (name: AutomationEventName, data: Record<string, unknown>) => void;

type Commit = { url: string; at: number };

let sink: AutomationEventSink | null = null;
let stopWatching: (() => void) | null = null;
let startedAt = 0;
const commits = new Map<string, Commit>();

function windowData(s: BrowserState, windowId: string) {
  return { windowId, kind: eligibleKind(s, windowId)!, profile: s.windows[windowId]!.profileId };
}

function tabData(s: BrowserState, tabId: string) {
  const t = s.tabs[tabId]!;
  return { windowId: t.windowId, tabId, profile: t.profileId, ...shownPage(t) };
}

export function diffStates(s: BrowserState, prev: BrowserState, send: AutomationEventSink) {
  const layout = s.windows !== prev.windows || s.tabs !== prev.tabs || s.peeks !== prev.peeks;
  if (s.windows !== prev.windows) {
    for (const id in s.windows) if (eligibleKind(s, id) && !eligibleKind(prev, id)) send("window.opened", windowData(s, id));
  }
  if (layout) {
    for (const id in s.tabs) if (isEligibleTab(s, id) && !isEligibleTab(prev, id)) send("tab.opened", tabData(s, id));
    for (const id in s.windows) {
      if (!eligibleKind(s, id)) continue;
      const active = activeTabId(s, id);
      if (active && active !== activeTabId(prev, id) && isEligibleTab(s, active)) send("tab.activated", tabData(s, active));
    }
  }
  const focused = focusedWindowOf(s);
  if (focused && focused !== focusedWindowOf(prev) && eligibleKind(s, focused)) send("window.focused", windowData(s, focused));
  if (layout) {
    for (const id in prev.tabs) if (isEligibleTab(prev, id) && !isEligibleTab(s, id)) send("tab.closed", tabData(prev, id));
  }
  if (s.windows !== prev.windows) {
    for (const id in prev.windows) if (eligibleKind(prev, id) && !eligibleKind(s, id)) send("window.closed", windowData(prev, id));
  }
  if (s.settings !== prev.settings) {
    const keys = (Object.keys(s.settings) as (keyof BrowserState["settings"])[]).filter((key) => s.settings[key] !== prev.settings[key]);
    if (keys.length) send("settings.changed", { keys });
  }
}

const SAME_DOCUMENT_HOLD_MS = 100;

type HeldNavigation = { url: string; sameDocument: boolean; due: number };

const heldNavigations = new Map<string, HeldNavigation[]>();
const releaseTimers = new Map<string, ReturnType<typeof setTimeout>>();

function sendNavigated(tabId: string, { url, sameDocument }: HeldNavigation) {
  const s = useBrowser.getState();
  if (!sink || !isEligibleTab(s, tabId)) return;
  const t = s.tabs[tabId]!;
  sink("tab.navigated", { windowId: t.windowId, tabId, profile: t.profileId, ...shownPage({ ...t, url }), sameDocument });
}

function releaseNavigations(tabId: string) {
  clearTimeout(releaseTimers.get(tabId));
  releaseTimers.delete(tabId);
  const queue = heldNavigations.get(tabId);
  if (!queue) return;
  const now = Date.now();
  while (queue.length && queue[0]!.due <= now) sendNavigated(tabId, queue.shift()!);
  if (!queue.length) return void heldNavigations.delete(tabId);
  releaseTimers.set(tabId, setTimeout(() => releaseNavigations(tabId), queue[0]!.due - now));
}

function holdNavigation(tabId: string, url: string, sameDocument: boolean) {
  const kept = (heldNavigations.get(tabId) ?? []).filter((held) => sameDocument || !held.sameDocument || held.url !== url);
  kept.push({ url, sameDocument, due: sameDocument ? Date.now() + SAME_DOCUMENT_HOLD_MS : 0 });
  heldNavigations.set(tabId, kept);
  releaseNavigations(tabId);
}

export function noteCommit(tabId: string, url: string | undefined, at: number | undefined) {
  if (!sink || url === undefined || at === undefined || !url || url === "about:blank") return;
  const last = commits.get(tabId) ?? { url: "", at: startedAt };
  if (at <= last.at && url === last.url) return;
  commits.set(tabId, { url, at: Math.max(at, last.at) });
  holdNavigation(tabId, url, at <= last.at);
}

export function startEventFeed(send: AutomationEventSink) {
  sink = send;
  if (stopWatching) return;
  startedAt = Date.now();
  void reportPageCommits(true).catch(() => {});
  const s = useBrowser.getState();
  for (const id in s.tabs) commits.set(id, { url: s.tabs[id]!.url, at: startedAt });
  const unsubscribe = useBrowser.subscribe((next, prev) => {
    diffStates(next, prev, (name, data) => sink?.(name, data));
    if (next.tabs !== prev.tabs) for (const id of commits.keys()) if (!next.tabs[id]) commits.delete(id);
  });
  stopWatching = unsubscribe;
}

export function stopEventFeed() {
  if (stopWatching) void reportPageCommits(false).catch(() => {});
  stopWatching?.();
  stopWatching = null;
  sink = null;
  commits.clear();
  for (const timer of releaseTimers.values()) clearTimeout(timer);
  releaseTimers.clear();
  heldNavigations.clear();
}
