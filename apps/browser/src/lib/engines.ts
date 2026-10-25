import { addHistoryVisits, type PageEngine } from "@ardia/ardiacore";
import { confirm } from "@ardia/shell";
import { create } from "zustand";
import { useBrowser } from "../store/browser";
import { canSwitchEngine, ENGINE_NAMES, ruleFor, siteOf, tabEngine, visitRecorder, type WebKitPage } from "../store/engines";
import { engineProfile, isIncognitoProfile, navigationTo } from "../store/model";
import { wantsPage } from "./tabPages";
import { webviews } from "./webviews";

export type EngineOffer = { site: string; host: string; keySystem: string };

export const useEngineOffers = create<Record<string, EngineOffer>>(() => ({}));

const store = () => useBrowser.getState();
const declinedSites = new Set<string>();

const UNSAVED_WORK = `(() => {
  const fields = Array.from(document.querySelectorAll("input:not([type=hidden]):not([type=password]):not([type=submit]):not([type=button]), textarea, select"));
  const changed = (f) => f.type === "checkbox" || f.type === "radio" ? f.checked !== f.defaultChecked : f.tagName === "SELECT" ? Array.from(f.options).some((o) => o.selected !== o.defaultSelected) : f.value !== f.defaultValue;
  const editing = document.activeElement && document.activeElement.isContentEditable;
  post("result", JSON.stringify(fields.some(changed) || !!editing));
})()`;

async function hasUnsavedWork(tabId: string): Promise<boolean> {
  const web = webviews.get(tabId);
  if (!web) return false;
  return (await Promise.race([web.evaluate<boolean>(UNSAVED_WORK), new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500))])) === true;
}

export function setWebsiteEngine(url: string, engine: PageEngine | null) {
  const site = siteOf(url);
  if (!site) return;
  const rules = { ...store().settings.websiteEngines };
  if (engine) rules[site] = engine;
  else delete rules[site];
  store().updateSettings({ websiteEngines: rules });
}

export function persistEngine(tabId: string, engine: PageEngine) {
  const t = store().tabs[tabId];
  if (t && !t.engine) store().updateTab(tabId, { engine });
}

export async function openPageIn(tabId: string, engine: PageEngine, options: { rule?: PageEngine | null; checkWork?: boolean } = {}): Promise<boolean> {
  const t = store().tabs[tabId];
  if (!t) return false;
  const url = t.url || t.navigation?.url || "";
  if (!canSwitchEngine(url)) return false;
  const saveRule = () => options.rule !== undefined && !isIncognitoProfile(t.profileId) && setWebsiteEngine(url, options.rule);
  clearEngineOffer(tabId);
  if (tabEngine(store(), tabId) === engine) {
    saveRule();
    return true;
  }
  if (options.checkWork !== false && wantsPage(t) && (await hasUnsavedWork(tabId))) {
    const { confirmed } = await confirm({
      title: `Open this page in ${ENGINE_NAMES[engine]}?`,
      message: `The page reloads in ${ENGINE_NAMES[engine]}, so changes you made on it may not be saved.`,
      confirmTitle: `Open in ${ENGINE_NAMES[engine]}`,
      windowId: t.windowId,
    });
    if (!confirmed) return false;
  }
  const now = store().tabs[tabId];
  if (!now || (now.url || now.navigation?.url || "") !== url) return false;
  saveRule();
  if (tabEngine(store(), tabId) === engine) return true;
  store().updateTab(tabId, wantsPage(now) ? { engine, adoptId: undefined, navigation: navigationTo(now.url || url, true) } : { engine });
  return true;
}

export const togglePageEngine = (tabId: string) => openPageIn(tabId, tabEngine(store(), tabId) === "webkit" ? "chromium" : "webkit");

export function offerWebKit(tabId: string, data: unknown) {
  const s = store();
  const t = s.tabs[tabId];
  if (!t || tabEngine(s, tabId) === "webkit") return;
  const site = siteOf(t.url);
  if (!site) return;
  const rule = ruleFor(s, t.url);
  if (rule === "chromium") return;
  if (rule === "webkit") return void openPageIn(tabId, "webkit", { checkWork: false });
  if (declinedSites.has(site) || useEngineOffers.getState()[tabId]?.site === site) return;
  const keySystem = typeof (data as { keySystem?: unknown } | null)?.keySystem === "string" ? (data as { keySystem: string }).keySystem : "";
  useEngineOffers.setState({ [tabId]: { site, host: new URL(site).hostname.replace(/^www\./, ""), keySystem } });
}

export function clearEngineOffer(tabId: string) {
  if (!useEngineOffers.getState()[tabId]) return;
  useEngineOffers.setState((offers) => {
    const { [tabId]: _, ...rest } = offers;
    return rest;
  }, true);
}

export function stayOnPage(tabId: string) {
  const offer = useEngineOffers.getState()[tabId];
  if (offer) declinedSites.add(offer.site);
  clearEngineOffer(tabId);
}

export const acceptEngineOffer = (tabId: string) => openPageIn(tabId, "webkit", { rule: "webkit" });

const visits = visitRecorder(
  (profile, visit) => void addHistoryVisits(profile, [{ url: visit.url, title: visit.title, visitTimes: [visit.at] }]).catch(() => {}),
  { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
  Date.now,
);

const visitedTabs = new Set<string>();
let unwatch: (() => void) | null = null;

function watchClosedTabs() {
  unwatch ??= useBrowser.subscribe((s, prev) => {
    if (s.tabs === prev.tabs) return;
    for (const id of visitedTabs) {
      if (s.tabs[id]) continue;
      visitedTabs.delete(id);
      visits.close(id);
    }
  });
}

export function noteWebKitPage(tabId: string, page: WebKitPage) {
  const t = store().tabs[tabId];
  if (!t) return;
  watchClosedTabs();
  visitedTabs.add(tabId);
  visits.note(tabId, isIncognitoProfile(t.profileId) ? null : engineProfile(t.profileId), page);
}
