import { readDocument, writeDocument } from "../../platform/documents";
import { versionedJson, upgraded, type Migrations } from "../../lib/savedDocument";
import { useBrowser, type BrowserState } from "../browser/store";
import { isIncognitoProfile } from "../browser/model";
import { isPeekTab } from "../peek/peek";
import type { Tab } from "../browser/types";
import { pageKey } from "../favicons/favicons";
import { launchFavicons, seedFavicons, type LaunchFavicons } from "../favicons/launchFavicons";

const DOCUMENT = "launch-look.json";
const VERSION = 2;
const MIGRATIONS: Migrations = {};
const DOCUMENT_LIMIT = 1100 * 1024;
const THEME_LIMIT = 200;
const COLOR_LENGTH_LIMIT = 64;
const RESTORED_THEME_GRACE_MS = 1500;

type RestoredTheme = { tab: string; page: string; color: string };
type LaunchLook = { themes: RestoredTheme[]; favicons: LaunchFavicons };

const restored = new Map<string, { page: string; color: string }>();
const settling = new Map<string, ReturnType<typeof setTimeout>>();

function savedTabs(s: BrowserState): Tab[] {
  const windowIds = [...new Set([...s.ui.focusOrder, ...s.windowOrder])];
  return windowIds.flatMap((id) => {
    const w = s.windows[id];
    if (!w || w.incognito || w.kind === "small") return [];
    return w.tabIds.map((tabId) => s.tabs[tabId]).filter((t): t is Tab => !!t && !!t.url && !isIncognitoProfile(t.profileId) && !isPeekTab(s, t.id));
  });
}

export function saveLaunchLook(s: BrowserState) {
  const tabs = savedTabs(s);
  const themes = tabs
    .flatMap((t) => {
      const color = s.live[t.id]?.themeColor;
      return color ? [{ tab: t.id, page: pageKey(t.url), color }] : [];
    })
    .slice(0, THEME_LIMIT);
  const look: LaunchLook = { themes, favicons: launchFavicons(tabs) };
  const json = versionedJson(look, VERSION);
  try {
    writeDocument(DOCUMENT, json.length <= DOCUMENT_LIMIT ? json : versionedJson({ ...look, favicons: { images: [], profiles: {}, themes: {} } }, VERSION));
  } catch (error) {
    console.warn(`Couldn't save ${DOCUMENT}`, error);
  }
}

function readLaunchLook(): LaunchLook | null {
  try {
    const json = readDocument(DOCUMENT);
    const look = json ? (upgraded(JSON.parse(json), VERSION, MIGRATIONS) as Partial<LaunchLook> | null) : null;
    if (!look || !Array.isArray(look.themes) || !look.favicons || typeof look.favicons !== "object") return null;
    return look as LaunchLook;
  } catch (error) {
    console.warn(`Couldn't read ${DOCUMENT}`, error);
    return null;
  }
}

const isRestoredTheme = (t: unknown): t is RestoredTheme => {
  const r = t as RestoredTheme | null;
  return !!r && typeof r.tab === "string" && typeof r.page === "string" && typeof r.color === "string" && r.color.length <= COLOR_LENGTH_LIMIT;
};

export function restoreLaunchLook() {
  const look = readLaunchLook();
  if (!look) return;
  seedFavicons(look.favicons);
  const s = useBrowser.getState();
  const live: BrowserState["live"] = {};
  for (const theme of look.themes.filter(isRestoredTheme)) {
    const tab = s.tabs[theme.tab];
    const now = s.live[theme.tab];
    if (!tab || !now || now.themeColor || pageKey(tab.url) !== theme.page) continue;
    restored.set(theme.tab, { page: theme.page, color: theme.color });
    live[theme.tab] = { ...now, themeColor: theme.color };
  }
  if (Object.keys(live).length) useBrowser.setState((now) => ({ live: { ...now.live, ...live } }));
}

const onBlank = (url: string) => !url || url === "about:blank";

function releaseRestoredTheme(tabId: string) {
  restored.delete(tabId);
  clearTimeout(settling.get(tabId));
  settling.delete(tabId);
}

function settleRestoredTheme(tabId: string) {
  if (settling.has(tabId)) return;
  settling.set(
    tabId,
    setTimeout(() => {
      settling.delete(tabId);
      if (!restored.delete(tabId)) return;
      useBrowser.getState().updateLive(tabId, { themeColor: null });
    }, RESTORED_THEME_GRACE_MS),
  );
}

export function restoredThemeColor(tabId: string, url: string, reported: string | null | undefined, isLoading: boolean): string | null {
  const held = restored.get(tabId);
  if (!held) return reported ?? null;
  if (reported || (!onBlank(url) && pageKey(url) !== held.page)) {
    releaseRestoredTheme(tabId);
    return reported ?? null;
  }
  if (!isLoading && !onBlank(url)) settleRestoredTheme(tabId);
  return held.color;
}
