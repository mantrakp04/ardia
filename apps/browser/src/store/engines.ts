import type { PageEngine } from "@ardia/ardiacore";
import type { BrowserState } from "./browser";
import type { Tab } from "./types";

export const ENGINE_NAMES: Record<PageEngine, string> = { chromium: "Chromium", webkit: "WebKit" };
export const ENGINE_SYMBOLS: Record<PageEngine, string> = { chromium: "globe", webkit: "safari" };
export const RECOMMENDED_ENGINE: PageEngine = "chromium";
export const otherEngine = (engine: PageEngine): PageEngine => (engine === "webkit" ? "chromium" : "webkit");

type EngineState = Pick<BrowserState, "tabs" | "settings">;

export function siteOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? `${u.protocol}//${u.host}`.toLowerCase() : null;
  } catch {
    return null;
  }
}

export const canSwitchEngine = (url: string | undefined | null) => !!url && /^(https?|file):/i.test(url);
export const chromiumOnly = (url: string | undefined | null) => !!url && /^(ardia|chrome|chrome-extension|chrome-untrusted|devtools|view-source):/i.test(url);

export const defaultEngine = (s: Pick<BrowserState, "settings">): PageEngine => (s.settings.pageEngine === "webkit" ? "webkit" : "chromium");

export function ruleFor(s: Pick<BrowserState, "settings">, url: string | undefined | null): PageEngine | undefined {
  const site = siteOf(url);
  return site ? s.settings.websiteEngines?.[site] : undefined;
}

export const engineForUrl = (s: Pick<BrowserState, "settings">, url: string | undefined | null): PageEngine => ruleFor(s, url) ?? defaultEngine(s);

const fromAdoption = (s: EngineState, t: Tab, depth: number): PageEngine | undefined => {
  const id = t.adoptId;
  if (!id) return undefined;
  if (id.startsWith("webkit:")) return "webkit";
  if (id.startsWith("ardiacore:") || id.startsWith("tab:")) return "chromium";
  if (id.startsWith("clone:")) {
    const source = s.tabs[id.slice("clone:".length)];
    return source && depth < 8 ? engineOf(s, source, depth + 1) : undefined;
  }
  return undefined;
};

function engineOf(s: EngineState, t: Tab, depth: number): PageEngine {
  if (chromiumOnly(t.navigation?.url ?? t.url)) return "chromium";
  if (t.engine) return t.engine;
  const adopted = fromAdoption(s, t, depth);
  if (adopted) return adopted;
  const opener = t.openerId ? s.tabs[t.openerId] : undefined;
  if (opener?.engine && (opener.url || opener.navigation)) return opener.engine;
  return engineForUrl(s, t.navigation?.url ?? t.url);
}

export function tabEngine(s: EngineState, tabId: string): PageEngine {
  const t = s.tabs[tabId];
  return t ? engineOf(s, t, 0) : defaultEngine(s);
}

export function typedNavigationEngine(s: EngineState, tab: Tab, url: string): PageEngine {
  if (chromiumOnly(url)) return "chromium";
  const rule = ruleFor(s, url);
  if (rule) return rule;
  return tab.url || tab.navigation ? tabEngine(s, tab.id) : defaultEngine(s);
}

export function engineMark(s: EngineState, tabId: string): PageEngine | null {
  const t = s.tabs[tabId];
  if (!t || !canSwitchEngine(t.url || t.navigation?.url)) return null;
  const engine = tabEngine(s, tabId);
  return engine === defaultEngine(s) ? null : engine;
}

export type WebKitPage = { url: string; title: string; isLoading: boolean; committedUrl: string };
export type RecordedVisit = { url: string; title: string; at: number };
type Visit = RecordedVisit & { staleTitle: string; profile: string | null; timer?: unknown };
type VisitTimers = { set(run: () => void, ms: number): unknown; clear(handle: unknown): void };

export const VISIT_SETTLE_MS = 1500;

export function visitRecorder(write: (profile: string, visit: RecordedVisit) => void, timers: VisitTimers, now: () => number) {
  const open = new Map<string, Visit>();
  const done = new Map<string, string>();
  const finish = (tabId: string, visit: Visit) => {
    if (visit.timer !== undefined) timers.clear(visit.timer);
    visit.timer = undefined;
    if (open.get(tabId) === visit) open.delete(tabId);
    done.set(tabId, visit.url);
    if (visit.profile !== null) write(visit.profile, { url: visit.url, title: visit.title, at: visit.at });
  };
  return {
    note(tabId: string, profile: string | null, page: WebKitPage) {
      const { url, title, isLoading, committedUrl } = page;
      if (!/^https?:/i.test(url) || url !== committedUrl) return;
      let visit = open.get(tabId);
      if (visit && visit.url !== url) {
        finish(tabId, visit);
        visit = undefined;
      }
      if (!visit) {
        if (done.get(tabId) === url) return;
        done.delete(tabId);
        visit = { url, title, at: now(), staleTitle: title, profile };
        open.set(tabId, visit);
      } else if (title) visit.title = title;
      if (title && title !== visit.staleTitle) return finish(tabId, visit);
      if (isLoading || visit.timer !== undefined) return;
      const settling = visit;
      settling.timer = timers.set(() => {
        if (open.get(tabId) === settling) finish(tabId, settling);
      }, VISIT_SETTLE_MS);
    },
    close(tabId: string) {
      const visit = open.get(tabId);
      if (visit) finish(tabId, visit);
      open.delete(tabId);
      done.delete(tabId);
    },
    size: () => open.size + done.size,
  };
}
