import { hostOf } from "@ardia/core";
import { translation } from "../../platform/text";
import { create } from "zustand";
import { webviews } from "../../platform/webviews";
import { useBrowser } from "../browser/store";
import { changedIds } from "../browser/changes";
import { incognitoOriginal, isIncognitoProfile } from "../browser/model";
import { hideKeyedToast, showToast } from "../app/toasts";
import { translatorCall, type Passage } from "./pageTranslator";
import { errorText } from "../../lib/errors";

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

const BATCH = 8;
const BATCH_CHARS = 2000;
const FOLLOW_MS = 600;
const PROGRESS_AFTER_MS = 1200;
const PROGRESS_TOAST = "translate-progress";

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
  const sample = await webviews.get(tabId)?.evaluate<Sample>(translatorCall("sample"));
  if (!sample || !translation) return null;
  const detected = sample.text.length >= 40 ? await translation.detect(sample.text.slice(0, 3000)) : null;
  return { language: detected ?? (sample.lang ? String(sample.lang).slice(0, 20) : null), active: !!sample.active };
}

async function detect(tabId: string) {
  const tab = useBrowser.getState().tabs[tabId];
  if (!translation || !tab || !translatableHost(tab.url)) return set(tabId, IDLE);
  const page = await pageLanguage(tabId);
  if (!page) return;
  if (!page.active && stateOf(tabId).status === "translated") toIdle(tabId);
  if (isNeverTranslated(tab.profileId, tab.url)) return setSource(tabId, null);
  const mine = new Set(languages().map(baseLanguage));
  const source = page.language && !mine.has(baseLanguage(page.language)) ? page.language : null;
  if (source && (await translation.status(source, defaultTarget())) === "unsupported") return setSource(tabId, null);
  setSource(tabId, source);
}

type Batch = { passages: Passage[]; more: boolean; gone: boolean; done: number; total: number };

type Translated = [number, string | null];

async function translatePassages(source: string, target: string, passages: Passage[]): Promise<Translated[]> {
  const texts = passages.map(([, pieces]) => pieces.map(([, text]) => text));
  const whole = await translation!.translateBlocks(source, target, texts);
  const out: Translated[] = [];
  const loose: [number, string][] = [];
  passages.forEach(([, pieces], i) => {
    const parts = whole[i];
    if (parts && parts.length === pieces.length) pieces.forEach(([id], j) => out.push([id, parts[j] ?? ""]));
    else loose.push(...pieces);
  });
  if (loose.length) {
    const texts = await translation!.translate(source, target, loose.map(([, text]) => text));
    loose.forEach(([id], i) => out.push([id, texts[i] ?? null]));
  }
  return out;
}

async function drain(tabId: string, token: string, onProgress?: (done: number, total: number) => void): Promise<boolean> {
  for (;;) {
    const current = stateOf(tabId);
    const web = webviews.get(tabId);
    if (current.status === "idle" || current.token !== token || !web) return false;
    const { source, target } = current;
    const batch = await web.evaluate<Batch>(translatorCall("next", token, BATCH, BATCH_CHARS));
    if (!batch || batch.gone || !Array.isArray(batch.passages)) return false;
    const passages = batch.passages
      .slice(0, BATCH * 4)
      .filter((p): p is Passage => Array.isArray(p) && Array.isArray(p[1]))
      .map(([id, pieces]): Passage => [id, pieces.filter((x) => Array.isArray(x) && typeof x[1] === "string").slice(0, 40)]);
    if (passages.length) {
      let results: Translated[];
      try {
        results = await translatePassages(source, target, passages);
      } catch (error) {
        const untranslated: Translated[] = passages.flatMap(([, pieces]) => pieces.map(([id]): Translated => [id, null]));
        await web.evaluate(translatorCall("apply", untranslated)).catch(() => {});
        throw error;
      }
      if (!holds(tabId, token)) return false;
      await web.evaluate(translatorCall("apply", results));
    }
    onProgress?.(batch.done, batch.total);
    if (!batch.more) return true;
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
  try {
    const status = await translation.status(source, target);
    if (status === "unsupported") return toast(tabId, `Translation error (${languageName(source)} to ${languageName(target)} isn't available)`);
    if (status === "supported") await translation.prepare(source, target);
    const token = Math.random().toString(36).slice(2);
    set(tabId, { status: "translating", source, target, token });
    if (!(await webviews.get(tabId)?.evaluate<boolean>(translatorCall("start", token)))) throw new Error("the page isn't ready");
    const started = Date.now();
    const done = await drain(tabId, token, (n, total) => {
      if (Date.now() - started < PROGRESS_AFTER_MS || total <= 0) return;
      shown = true;
      toast(tabId, `Translating to ${languageName(target)}…`, `${Math.min(99, Math.round((n / total) * 100))}%`, true);
    });
    if (!done) {
      if (holds(tabId, token)) toIdle(tabId);
      if (shown) hideKeyedToast(tab.windowId, PROGRESS_TOAST);
      return;
    }
    if (holds(tabId, token)) set(tabId, { status: "translated", source, target, token });
    toast(tabId, `Translated to ${languageName(target)}`);
    void follow(tabId, token);
  } catch (error) {
    await revertPage(tabId, { quiet: true });
    const reason = errorText(error);
    toast(tabId, `Translation error (${reason.replace(/[.\s]+$/, "")})`);
  }
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

export function startTranslate() {
  if (!translation) return () => {};
  return useBrowser.subscribe((s, prev) => {
    for (const id of changedIds(s.live, prev.live)) {
      if (s.live[id] && prev.live[id]?.isLoading && !s.live[id].isLoading) void detect(id).catch(() => {});
    }
    if (s.tabs === prev.tabs) return;
    const gone = Object.keys(useTranslate.getState()).filter((id) => !s.tabs[id]);
    if (gone.length) useTranslate.setState(Object.fromEntries(gone.map((id) => [id, undefined])));
  });
}
