import { cancelDailyBriefGeneration, generateDailyBrief } from "../../platform/briefs";
import { readDocument, writeDocument } from "../../platform/documents";
import { create } from "zustand";
import { collectBriefContext, generateClaudeBrief } from "./briefContext";
import { useBrowser } from "../browser/store";
import { isIncognitoProfile } from "../browser/model";
import { briefDateFromUrl, briefDue, briefRetryDue, localBriefDate } from "../../lib/briefDates";
import { retainedBriefDates } from "../../lib/briefRetention";

import { briefSummary, briefEventTime, focusBriefLinks, parseBriefContent, updateBriefSource, type BriefContent } from "../../lib/briefContent";
export type { BriefContent } from "../../lib/briefContent";
type Entry = { content?: BriefContent; loading?: boolean; error?: string | null };
export const useDailyBriefs = create<{ entries: Record<string, Entry> }>()(() => ({ entries: {} }));
const keyFor = (profileId: string, date: string) => `${profileId}/${date}`;
const pending = new Set<string>();
type SavedBriefs = Record<string, BriefContent | null>;

function readSavedBriefs(): SavedBriefs {
  try {
    const raw = readDocument("daily-briefs.json");
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as SavedBriefs : {};
  } catch {
    return {};
  }
}

function pruneSavedBriefs(saved: SavedBriefs): SavedBriefs {
  const dates = retainedBriefDates(Object.keys(saved).map((key) => key.slice(-10)));
  const keep = new Set(dates);
  return Object.fromEntries(Object.entries(saved).filter(([key]) => keep.has(key.slice(-10))));
}

function updateSavedBriefs(key?: string, content: BriefContent | null = null): SavedBriefs {
  const original = readSavedBriefs();
  const saved = pruneSavedBriefs(key ? { ...original, [key]: content ?? original[key] ?? null } : original);
  if (JSON.stringify(saved) !== JSON.stringify(original)) writeDocument("daily-briefs.json", JSON.stringify(saved));
  return saved;
}

export function listDailyBriefDates(profileId: string): string[] {
  if (isIncognitoProfile(profileId)) return [];
  return retainedBriefDates(Object.keys(updateSavedBriefs()).filter((key) => key.startsWith(`${profileId}/`)).map((key) => key.slice(-10)));
}

function patch(key: string, entry: Entry) {
  useDailyBriefs.setState((s) => ({ entries: { ...s.entries, [key]: { ...s.entries[key], ...entry } } }));
}

export function loadDailyBrief(profileId: string, date: string) {
  const key = keyFor(profileId, date);
  if (isIncognitoProfile(profileId) || useDailyBriefs.getState().entries[key]) return;
  try {
    const saved = updateSavedBriefs();
    if (saved[key]) patch(key, { content: parseBriefContent(JSON.stringify(saved[key])) });
  } catch {
    patch(key, { error: "This saved brief could not be read. You can generate it again." });
  }
}

function saveBrief(key: string, content: BriefContent) {
  updateSavedBriefs(key, content);
}

export async function generateBrief(profileId: string, date: string) {
  if (isIncognitoProfile(profileId)) return;
  const key = keyFor(profileId, date);
  if (pending.has(key)) return;
  pending.add(key);
  patch(key, { loading: true, error: null });
  const abort = new AbortController();
  const original = useBrowser.getState().settings;
  const consent = JSON.stringify(original.dailyBriefSources);
  const provider = original.dailyBriefProvider;
  const unsubscribe = useBrowser.subscribe((state) => {
    if (state.settings.dailyBriefProvider === provider && JSON.stringify(state.settings.dailyBriefSources) === consent) return;
    abort.abort();
    if (provider === "chatgpt") void Promise.resolve().then(cancelDailyBriefGeneration).catch(() => {});
  });
  try {
    if (date !== localBriefDate()) throw new Error("Past briefs are kept as they were. Generate today’s brief to use your current sources.");
    const context = await collectBriefContext(date);
    if (abort.signal.aborted || provider !== useBrowser.getState().settings.dailyBriefProvider || consent !== JSON.stringify(useBrowser.getState().settings.dailyBriefSources)) throw new Error("Your sharing preferences changed. Try again.");
    const input = JSON.stringify({ ...context, date });
    const raw = provider === "claude" ? await generateClaudeBrief(input, abort.signal) : await generateDailyBrief(input);
    if (abort.signal.aborted || provider !== useBrowser.getState().settings.dailyBriefProvider || consent !== JSON.stringify(useBrowser.getState().settings.dailyBriefSources)) throw new Error("Your sharing preferences changed. Generate a fresh brief with the new settings.");
    const content = parseBriefContent(raw);
    content.summary = briefSummary(content.summary);
    const links = [...context.github, ...(context.gmail ?? []).flatMap((message) => message.url ? [{ title: message.subject || "Gmail message", url: message.url, kind: "gmail" as const }] : [])];
    content.focus.links = focusBriefLinks(content.focus, links);
    const bindSource = (item: BriefContent["focus"]): BriefContent["focus"] => {
      const source = updateBriefSource(item, context.github, context.gmail ?? []);
      const { source: requestedSource, ...text } = item;
      return source ? { ...text, source } : text;
    };
    content.focus = bindSource(content.focus);
    content.todos = content.todos.map(bindSource);
    content.updates = content.updates.map(bindSource);
    content.events = (context.calendar ?? []).map((event) => {
      const generated = content.events.find((candidate) => candidate.title.trim().toLocaleLowerCase() === event.title.trim().toLocaleLowerCase());
      const item = { title: event.title, body: generated?.body ?? "Calendar event.", time: "", start: event.start, end: event.end, allDay: event.allDay };
      const display = briefEventTime(item);
      return { ...item, time: display.range, body: display.body };
    });
    saveBrief(key, content);
    patch(key, { content, loading: false });
  } catch (error) {
    patch(key, { loading: false, error: error instanceof Error ? error.message : "Could not generate your brief. Try again." });
  } finally {
    unsubscribe();
    pending.delete(key);
  }
}

export function openDailyBrief(windowId: string, date = localBriefDate(), background = false): string | null {
  const s = useBrowser.getState();
  const window = s.windows[windowId];
  if (!window || window.incognito || window.kind === "small" || isIncognitoProfile(window.profileId)) return null;
  updateSavedBriefs(keyFor(window.profileId, date));
  const existing = window.tabIds.find((id) => {
    const tab = s.tabs[id];
    return tab?.profileId === window.profileId && /^ardia:\/\/brief(?:\/|$)/i.test(tab.navigation?.url ?? tab.url) && briefDateFromUrl(tab.navigation?.url ?? tab.url) === date;
  });
  if (existing) {
    if (!background) s.activate(existing);
    return existing;
  }
  const id = s.newTab(windowId, { url: `ardia://brief/${date}`, background });
  return typeof id === "string" ? id : null;
}

const automaticPending = new Set<string>();

type BriefAttempts = Record<string, { count: number; lastAttempt: number }>;

function automaticAttempts(date: string): BriefAttempts {
  try {
    const saved = JSON.parse(readDocument("daily-brief-attempts.json") ?? "{}");
    if (saved.date !== date || !saved.profiles || typeof saved.profiles !== "object") return {};
    return Object.fromEntries(Object.entries(saved.profiles).filter((entry): entry is [string, { count: number; lastAttempt: number }] => {
      const value = entry[1] as { count?: unknown; lastAttempt?: unknown } | null;
      return !!value && typeof value.count === "number" && Number.isInteger(value.count) && value.count >= 0 && typeof value.lastAttempt === "number" && Number.isFinite(value.lastAttempt);
    }));
  } catch {
    return {};
  }
}

export async function deliverDailyBriefs(now = new Date()): Promise<void> {
  const s = useBrowser.getState();
  if (!s.settings.dailyBriefEnabled) return;
  const date = localBriefDate(now);
  const due = briefDue(s.settings, now);
  if (!due && s.settings.dailyBriefLastOpened !== date) return;
  const windowId = [s.ui.focusedWindowId, ...s.windowOrder].find((id) => {
    const w = id ? s.windows[id] : null;
    return w && !w.incognito && w.kind !== "small" && !isIncognitoProfile(w.profileId);
  });
  if (!windowId) return;
  if (due) {
    if (!openDailyBrief(windowId, date, true)) return;
    s.updateSettings({ dailyBriefLastOpened: date });
  }
  const profileId = s.windows[windowId]!.profileId;
  const key = keyFor(profileId, date);
  loadDailyBrief(profileId, date);
  if (useDailyBriefs.getState().entries[key]?.content || pending.has(key) || automaticPending.has(key)) return;
  const attempts = automaticAttempts(date);
  if (!briefRetryDue(attempts[profileId], now.getTime())) return;
  attempts[profileId] = { count: (attempts[profileId]?.count ?? 0) + 1, lastAttempt: now.getTime() };
  writeDocument("daily-brief-attempts.json", JSON.stringify({ date, profiles: attempts }));
  automaticPending.add(key);
  try {
    await generateBrief(profileId, date);
  } finally {
    automaticPending.delete(key);
  }
}

export function startDailyBriefs() {
  const tick = () => { void deliverDailyBriefs().catch(() => {}); };
  const timer = setInterval(tick, 30_000);
  const initial = setTimeout(tick, 1000);
  return () => { clearInterval(timer); clearTimeout(initial); };
}
