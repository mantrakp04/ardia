import { hostOf } from "@ardia/core";
import { translation } from "../../platform/text";
import { create } from "zustand";
import { webviews } from "../../platform/webviews";
import { useBrowser } from "../browser/store";
import { changedIds } from "../browser/changes";
import { incognitoOriginal, isIncognitoProfile } from "../browser/model";
import { hideKeyedToast, showToast } from "../app/toasts";
import { translatorCall } from "./pageTranslator";
import { stopDocumentWatch, watchDocument } from "./documentWatch";
import { drainPassages, type PageBatch, type Passage, type Translated } from "./translateDrain";
import { errorText } from "../../lib/errors";
import { capture } from "../telemetry/client";

export { translation } from "../../platform/text";

type TranslateState = { status: "idle"; source: string | null } | { status: "translating" | "translated"; source: string; target: string; token: string };

const IDLE: TranslateState = { status: "idle", source: null };
export const useTranslate = create<Record<string, TranslateState | undefined>>()(() => ({}));
const stateOf = (tabId: string) => useTranslate.getState()[tabId] ?? IDLE;
const set = (tabId: string, state: TranslateState) => useTranslate.setState({ [tabId]: state });
const toIdle = (tabId: string) => set(tabId, { status: "idle", source: stateOf(tabId).source });
function setSource(tabId: string, source: string | null) {
  if (stateOf(tabId).status === "idle") set(tabId, { status: "idle", source });
}
export const isTranslated = (tabId: string) => stateOf(tabId).status !== "idle";
export function translationTarget(tabId: string): string | null {
  const state = stateOf(tabId);
  return state.status === "idle" ? null : state.target;
}
export const useTranslateState = (tabId: string) => useTranslate((s) => s[tabId] ?? IDLE);

const IN_FLIGHT = 2;
const BATCH_CHARS = 2000;
const FOLLOW_MS = 600;
const DOCUMENT_POLL_MS = 250;
const PROGRESS_AFTER_MS = 1200;
const PROGRESS_TOAST = "translate-progress";

type TranslateStage = "detect" | "start" | "collect" | "model" | "apply" | "follow";
const stages: Record<string, TranslateStage | undefined> = {};
const atStage = (tabId: string, stage: TranslateStage) => void (stages[tabId] = stage);

export function translateCrashContext(tabId: string) {
  const all = Object.values(useTranslate.getState());
  return {
    translate: stateOf(tabId).status,
    translate_stage: stateOf(tabId).status === "idle" ? null : (stages[tabId] ?? null),
    translating_tabs: all.filter((s) => s?.status === "translating").length,
    translated_tabs: all.filter((s) => s?.status === "translated").length,
  };
}

export function baseLanguage(language: string): string {
  const [lang = "", second] = language.split(/[-_]/);
  if (lang.toLowerCase() === "zh") return second && /^(hant|tw|hk|mo)$/i.test(second) ? "zh-Hant" : "zh-Hans";
  return lang.toLowerCase();
}

let userLanguages: string[] | null = null;
function languages(): string[] {
  userLanguages ??= translation?.userLanguages() ?? [];
  return userLanguages;
}
export const defaultTarget = () => baseLanguage(languages()[0] ?? "en");
export const languageName = (language: string) => translation?.languageName(language) ?? language;

const translatableHost = (url: string) => (/^https?:/i.test(url) ? hostOf(url) : "");

function listOwner(profileId: string): string {
  return isIncognitoProfile(profileId) ? incognitoOriginal(profileId) : profileId;
}
export function isNeverTranslated(profileId: string, url: string): boolean {
  const host = translatableHost(url);
  return !!host && (useBrowser.getState().settings.neverTranslateSites[listOwner(profileId)] ?? []).includes(host);
}
export function setNeverTranslate(tabId: string, never: boolean) {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  const host = tab ? translatableHost(tab.url) : "";
  if (!tab || !host || isIncognitoProfile(tab.profileId)) return;
  const all = s.settings.neverTranslateSites;
  const list = (all[tab.profileId] ?? []).filter((h) => h !== host);
  s.updateSettings({ neverTranslateSites: { ...all, [tab.profileId]: never ? [...list, host] : list } });
  if (!never) return void detect(tabId);
  if (stateOf(tabId).status !== "idle") void revertPage(tabId, { quiet: true });
  setSource(tabId, null);
}

type Sample = { lang: string; text: string; active: boolean };

async function pageLanguage(tabId: string): Promise<{ language: string | null; active: boolean } | null> {
  if (stateOf(tabId).status !== "idle") atStage(tabId, "detect");
  const sample = await webviews.get(tabId)?.evaluate<Sample>(translatorCall("sample"));
  if (!sample || !translation) return null;
  const detected = sample.text.length >= 40 ? await translation.detect(sample.text.slice(0, 3000)) : null;
  return { language: detected ?? (sample.lang ? String(sample.lang).slice(0, 20) : null), active: !!sample.active };
}

async function detect(tabId: string) {
  const tab = useBrowser.getState().tabs[tabId];
  if (!translation || !tab || !translatableHost(tab.url)) return set(tabId, IDLE);
  const before = stateOf(tabId);
  const page = await pageLanguage(tabId);
  if (!page) return;
  if (!page.active && before.status !== "idle" && holds(tabId, before.token)) toIdle(tabId);
  if (isNeverTranslated(tab.profileId, tab.url)) return setSource(tabId, null);
  const mine = new Set(languages().map(baseLanguage));
  const source = page.language && !mine.has(baseLanguage(page.language)) ? page.language : null;
  if (source && (await translation.status(source, defaultTarget())) === "unsupported") return setSource(tabId, null);
  setSource(tabId, source);
}

type BlockTranslator = Pick<NonNullable<typeof translation>, "translateBlocks">;

export async function translatePassage(model: BlockTranslator, source: string, target: string, [, pieces]: Passage, token: string, progress: { unlinked: number }, live: () => boolean): Promise<Translated[]> {
  const texts = pieces.map(([, text]) => text);
  const [parts] = await model.translateBlocks(source, target, [texts], token);
  if (parts && parts.length === pieces.length) return pieces.map(([id], j) => [id, parts[j] ?? ""]);
  if (!live()) return pieces.map(([id]) => [id, null]);
  if (pieces.length > 1) progress.unlinked++;
  const single = await model.translateBlocks(source, target, texts.map((text) => [text]), token);
  if (live() && single.every((part) => !part)) throw new Error("the Mac's translation model didn't answer");
  return pieces.map(([id], i) => [id, single[i]?.[0] ?? null]);
}

type Progress = { applied: number; unlinked: number; firstAppliedAt: number | null };

function untilReleased(tabId: string, token: string) {
  let stop = () => {};
  const promise = new Promise<void>((resolve) => {
    if (!holds(tabId, token)) return resolve();
    stop = useTranslate.subscribe(() => {
      if (!holds(tabId, token)) resolve();
    });
  });
  return { promise, stop: () => stop() };
}

async function drain(tabId: string, token: string, onProgress?: (done: number, total: number) => void, progress: Progress = { applied: 0, unlinked: 0, firstAppliedAt: null }): Promise<boolean> {
  const current = stateOf(tabId);
  if (current.status === "idle" || current.token !== token) return false;
  const { source, target } = current;
  const released = untilReleased(tabId, token);
  const page = () => {
    const web = webviews.get(tabId);
    if (!web) throw new Error("the tab closed");
    return web;
  };
  try {
    return await drainPassages({
      inFlight: IN_FLIGHT,
      holds: () => holds(tabId, token) && !!webviews.get(tabId),
      released: released.promise,
      next: (max) => page().evaluate<PageBatch>(translatorCall("next", token, max, BATCH_CHARS)),
      translate: (passage) => translatePassage(translation!, source, target, passage, token, progress, () => holds(tabId, token)),
      apply: (results) => page().evaluate(translatorCall("apply", token, results)),
      onStage: (stage) => atStage(tabId, stage),
      onApplied: (total) => {
        progress.firstAppliedAt ??= Date.now();
        onProgress?.(++progress.applied, total);
      },
    });
  } finally {
    released.stop();
  }
}

function holds(tabId: string, token: string) {
  const state = stateOf(tabId);
  return state.status !== "idle" && state.token === token;
}

async function follow(tabId: string, token: string) {
  for (;;) {
    await new Promise((r) => setTimeout(r, FOLLOW_MS));
    const current = stateOf(tabId);
    if (current.status !== "translated" || current.token !== token) return;
    atStage(tabId, "follow");
    try {
      if (await drain(tabId, token)) continue;
    } catch {}
    if (!holds(tabId, token)) return;
    if ((await pageLanguage(tabId).catch(() => null))?.active) continue;
    if (holds(tabId, token)) toIdle(tabId);
    return;
  }
}

function toast(tabId: string, title: string, message?: string, progress = false) {
  const windowId = useBrowser.getState().tabs[tabId]?.windowId;
  if (!windowId) return;
  if (progress) showToast(windowId, title, message, { icon: "translate", key: PROGRESS_TOAST, sticky: true });
  else showToast(windowId, title, message, { icon: "translate" });
}

export async function translatePage(tabId: string, target = defaultTarget()) {
  const tab = useBrowser.getState().tabs[tabId];
  if (!translation || !tab || !webviews.get(tabId)) return;
  await revertPage(tabId, { quiet: true });
  const source = stateOf(tabId).source ?? (await pageLanguage(tabId))?.language ?? null;
  if (!source) return toast(tabId, "Translation error (can't tell the page's language)");
  if (baseLanguage(source) === baseLanguage(target)) return toast(tabId, `Translation error (the page is already in ${languageName(target)})`);
  let shown = false;
  let started = 0;
  let token: string | null = null;
  const progress: Progress = { applied: 0, unlinked: 0, firstAppliedAt: null };
  try {
    const status = await translation.status(source, target);
    if (status === "unsupported") return toast(tabId, `Translation error (${languageName(source)} to ${languageName(target)} isn't available)`);
    if (status === "supported") await translation.prepare(source, target);
    const mine = (token = newToken());
    await translation.open(mine);
    set(tabId, { status: "translating", source, target, token: mine });
    atStage(tabId, "start");
    if (!(await webviews.get(tabId)?.evaluate<boolean>(translatorCall("start", mine)))) throw new Error("the page isn't ready");
    started = Date.now();
    const done = await drain(
      tabId,
      mine,
      (n, total) => {
        if (Date.now() - started < PROGRESS_AFTER_MS || total <= 0) return;
        shown = true;
        toast(tabId, `Translating to ${languageName(target)}…`, `${Math.min(99, Math.round((n / total) * 100))}%`, true);
      },
      progress,
    );
    if (!done) {
      if (holds(tabId, mine)) toIdle(tabId);
      if (shown && stateOf(tabId).status === "idle") hideKeyedToast(tab.windowId, PROGRESS_TOAST);
      return void reportFirstPass("stopped", started, progress);
    }
    reportFirstPass("done", started, progress);
    if (holds(tabId, mine)) set(tabId, { status: "translated", source, target, token: mine });
    toast(tabId, `Translated to ${languageName(target)}`);
    void follow(tabId, mine);
  } catch (error) {
    if (started) reportFirstPass("failed", started, progress);
    const replaced = token !== null && !holds(tabId, token);
    if (shown && (!replaced || stateOf(tabId).status === "idle")) hideKeyedToast(tab.windowId, PROGRESS_TOAST);
    if (replaced) return;
    if (token !== null) await revertPage(tabId, { quiet: true });
    const reason = errorText(error);
    toast(tabId, `Translation error (${reason.replace(/[.\s]+$/, "")})`);
  }
}

function reportFirstPass(outcome: "done" | "stopped" | "failed", started: number, progress: Progress) {
  capture("translate_finished", {
    outcome,
    first_pass_ms: Date.now() - started,
    first_text_ms: progress.firstAppliedAt === null ? null : progress.firstAppliedAt - started,
    passages: progress.applied,
    unlinked_passages: progress.unlinked,
  });
}

export async function revertPage(tabId: string, { quiet = false } = {}) {
  const { source, status } = stateOf(tabId);
  toIdle(tabId);
  await webviews.get(tabId)?.evaluate(translatorCall("revert"));
  if (!quiet && source && status !== "idle") toast(tabId, `Translated back to ${languageName(source)}`);
}

export function toggleTranslation(tabId: string) {
  if (stateOf(tabId).status === "idle") void translatePage(tabId);
  else void revertPage(tabId);
}

export async function otherLanguages(): Promise<{ id: string; name: string }[]> {
  if (!translation) return [];
  const best = new Map<string, string>();
  for (const id of await translation.supportedLanguages()) {
    const key = baseLanguage(id);
    const current = best.get(key);
    if (!current || id.length < current.length) best.set(key, id);
  }
  return [...best.values()].map((id) => ({ id, name: languageName(id) })).sort((a, b) => a.name.localeCompare(b.name));
}

function watchTabDocument(tabId: string) {
  const current = stateOf(tabId);
  if (current.status === "idle") return stopDocumentWatch(tabId);
  const { token } = current;
  void watchDocument(
    tabId,
    {
      holds: () => holds(tabId, token),
      loading: () => !!useBrowser.getState().live[tabId]?.isLoading,
      sameDocument: () => webviews.get(tabId)?.evaluate<boolean>(translatorCall("holds", token)) ?? Promise.resolve(undefined),
      release: () => toIdle(tabId),
      wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    },
    DOCUMENT_POLL_MS,
  ).catch(() => {});
}

export function releaseTranslation(tabId: string) {
  stopDocumentWatch(tabId);
  if (stateOf(tabId).status !== "idle") toIdle(tabId);
}

let tokens = 0;
const newToken = () => `${Date.now().toString(36)}-${++tokens}`;

const tokenOf = (state: TranslateState | undefined) => (state && state.status !== "idle" ? state.token : null);

export function cancelEndedTranslations(cancel: (token: string) => void) {
  return useTranslate.subscribe((s, prev) => {
    for (const id in prev) {
      const ended = tokenOf(prev[id]);
      if (ended && tokenOf(s[id]) !== ended) cancel(ended);
    }
  });
}

export function startTranslate() {
  if (!translation) return () => {};
  const model = translation;
  const stopCancelling = cancelEndedTranslations((token) => void model.cancel(token).catch(() => {}));
  const stopWatching = useBrowser.subscribe((s, prev) => {
    for (const id of changedIds(s.live, prev.live)) {
      if (s.live[id] && prev.live[id]?.isLoading && !s.live[id].isLoading) {
        stopDocumentWatch(id);
        void detect(id).catch(() => {});
      }
      if (s.live[id]?.isLoading && prev.live[id] && !prev.live[id].isLoading) watchTabDocument(id);
    }
    if (s.tabs === prev.tabs) return;
    const gone = Object.keys(useTranslate.getState()).filter((id) => !s.tabs[id]);
    for (const id of gone) {
      delete stages[id];
      stopDocumentWatch(id);
    }
    if (gone.length) useTranslate.setState(Object.fromEntries(gone.map((id) => [id, undefined])));
  });
  return () => {
    stopCancelling();
    stopWatching();
  };
}
