import { create } from "zustand";
import { applyAppearance } from "../../platform/appearance";
import { appVersion } from "../../platform/appInfo";
import { blocking, type BlockingCategory, type BlockingState } from "../../platform/blocking";
import { downloads, type DownloadProgress } from "../../platform/downloads";
import { pages } from "../../platform/pages";
import { openExternal, shareText } from "../../platform/system";
import { openPage } from "../browse/store";
import { history } from "../history/store";
import { settled } from "../pages/store";
import { searchEngines } from "../search/omnibox";
import { applySearchEngine } from "../search/store";
import { showToast } from "../toasts/store";
import { clearArchivedTabs, currentTabs, setAutoArchiveInterval } from "../tabs/store";
import type { AutoArchiveInterval } from "../tabs/tabModels";
import { closeSettings } from "./nav";
import type { ColorChoice, NightShadeMode, Preferences } from "./preferences";
import { clearSince, exportableUrls, websiteDataKinds, type ClearChoice, type ClearRange } from "./settingsRules";
import { currentPreferences, setPreference } from "./store";

export type { BlockingState, DownloadProgress };
export { appVersion };
export type FilterListInfo = BlockingState["lists"][number];

export const useBlocking = create<{ state: BlockingState | null; busy: boolean }>()(() => ({ state: null, busy: false }));

export const useDownloads = create<{ active: DownloadProgress[] }>()(() => ({ active: [] }));

export const useEngines = create<{ engines: { id: string; name: string }[]; nightShade: NightShadeMode }>()(() => ({ engines: [], nightShade: "disabled" }));

const quietly = (call: () => Promise<unknown>) => void settled(call, undefined);

let listening = false;

export function startSettingsSources() {
  if (listening) return;
  listening = true;
  applyAppearance(currentPreferences().appearance);
  try {
    blocking.addListener((event) => useBlocking.setState({ state: event.state }));
    downloads.addListener((event) => {
      if (event.name === "downloads.progress") useDownloads.setState({ active: event.downloads });
    });
  } catch {
    return;
  }
}

export async function refreshSettings() {
  const [state, active, shade, engines] = await Promise.all([
    settled(() => blocking.state(), null),
    settled(() => downloads.active(), [] as DownloadProgress[]),
    settled(() => pages.nightShade(null, false), null),
    settled(async () => searchEngines(), [] as { id: string; name: string }[]),
  ]);
  if (state) useBlocking.setState({ state });
  useDownloads.setState({ active });
  useEngines.setState({ engines, nightShade: shade?.defaultMode ?? "disabled" });
}

export function setSearchEngine(id: string) {
  setPreference("searchEngineId", id);
  applySearchEngine();
}

export const setSearchSuggestions = (on: boolean) => setPreference("searchSuggestions", on);
export const setAutoOpenKeyboard = (on: boolean) => setPreference("autoOpensKeyboard", on);
export const setColorChoice = (choice: ColorChoice) => setPreference("colorChoice", choice);
export const setArchiveInterval = (interval: AutoArchiveInterval) => setAutoArchiveInterval(interval);

export function setAppearance(mode: Preferences["appearance"]) {
  setPreference("appearance", mode);
  applyAppearance(mode);
}

export function setDefaultNightShade(mode: NightShadeMode) {
  setPreference("nightShade", mode);
  useEngines.setState({ nightShade: mode });
  quietly(() => pages.setNightShade(mode, null, false));
}

const withBlocking = (call: () => Promise<unknown>) =>
  quietly(async () => {
    await call();
    const state = await blocking.state();
    useBlocking.setState({ state });
  });

export const setBlockingCategory = (category: BlockingCategory, on: boolean) => withBlocking(() => blocking.setCategory(category, on));
export const setListEnabled = (id: string, on: boolean) => withBlocking(() => blocking.setListEnabled(id, on));
export const removeList = (id: string) => withBlocking(() => blocking.removeList(id));
export const resetLists = () => withBlocking(() => blocking.resetToDefaults());
export const trustSite = (host: string, trusted: boolean) => withBlocking(() => blocking.setEnabledForSite(`https://${host}/`, !trusted, false));

export function updateLists() {
  useBlocking.setState({ busy: true });
  quietly(async () => {
    await settled(() => blocking.updateLists(), undefined);
    const state = await blocking.state();
    useBlocking.setState({ state, busy: false });
  });
}

export async function addList(url: string): Promise<boolean> {
  const id = await settled(() => blocking.addCustomList(url), null);
  const state = await settled(() => blocking.state(), null);
  if (state) useBlocking.setState({ state });
  return id !== null;
}

export async function applyMyFilters(text: string) {
  const result = await settled(() => blocking.setMyFilters(text), null);
  const state = await settled(() => blocking.state(), null);
  if (state) useBlocking.setState({ state });
  return result;
}

export async function clearBrowsingData(choice: ClearChoice, range: ClearRange) {
  if (choice.history) history().clear(clearSince(range, Date.now()));
  const kinds = websiteDataKinds(choice);
  if (kinds.length) await settled(() => pages.clearWebsiteData(kinds), undefined);
  if (choice.archive && range === "allTime") clearArchivedTabs();
  showToast("Cleared Browsing Data", "checkmark");
}

export function exportOpenTabs() {
  const urls = exportableUrls(currentTabs().open);
  if (!urls.length) {
    showToast("No Open Tabs", "warning");
    return;
  }
  quietly(() => shareText(urls.join("\n"), "Open Tabs from Ardia"));
}

export const cancelDownload = (id: string) => quietly(() => downloads.cancel(id));

export function openFromSettings(url: string) {
  closeSettings();
  openPage(url, "link");
}

export const openOutside = (url: string) => quietly(() => openExternal(url));
