import { mobileClean } from "@ardia/core/src/mobile";
import { copyText, pressHaptic, shareLink, successHaptic } from "../../platform/system";
import { settled } from "../pages/store";
import { display, type TrayRow } from "../search/omnibox";
import { closeTabById, currentTabs, deleteArchivedTabsById, setIncognito, useTabs } from "../tabs/store";
import { isSyncableUrl, type BrowserTab } from "../tabs/tabModels";
import { recentOtherTabs, tabMenuTitle } from "../tabs/tabsState";
import { showToast } from "../toasts/store";
import { openPage, openTab, reopenArchived } from "./store";

export type RowAction = { label: string; icon: "eyes" | "squareOnSquare" | "link" | "squareAndArrowUp"; run: () => void };

function openSwitchingMode(url: string, origin: "search" | "typed") {
  setIncognito(!useTabs.getState().incognito);
  openPage(url, origin);
}

export function trayRowActions(row: TrayRow): RowAction[] {
  const incognito = useTabs.getState().incognito;
  const icon = incognito ? "squareOnSquare" : "eyes";
  if (row.kind === "query") {
    return [{ label: incognito ? "Search in New Tab" : "Search in Incognito Tab", icon, run: () => openSwitchingMode(row.url, "search") }];
  }
  if (row.kind === "calc") return [];
  return [
    { label: incognito ? "Open in New Tab" : "Open in Incognito Tab", icon, run: () => openSwitchingMode(row.url, "typed") },
    { label: "Copy Link", icon: "link", run: () => copyLink(row.url) },
    { label: "Share", icon: "squareAndArrowUp", run: () => quietly(() => shareLink(row.url, row.title)) },
  ];
}

export function copyLink(url: string) {
  quietly(() => copyText(mobileClean(url)));
  quietly(successHaptic);
  showToast(COPIED_LINK, "link");
}

export const COPIED_LINK = "Copied URL Without Trackers";

const quietly = (call: () => Promise<unknown>) => void settled(call, undefined);

export const canShareTab = (tab: BrowserTab) => isSyncableUrl(tab.url);

export const tabTitle = (tab: BrowserTab) => tabMenuTitle(tab, display(tab.url).host);

export function copyTabLink(tab: BrowserTab) {
  if (canShareTab(tab)) copyLink(tab.url);
}

export function shareTab(tab: BrowserTab) {
  if (!canShareTab(tab)) return;
  quietly(() => shareLink(tab.url, tab.title));
}

export const menuOpenedHaptic = () => quietly(pressHaptic);

export const recentTabs = (order: readonly BrowserTab[]) => recentOtherTabs(order);

export const switchToTab = (id: string) => openTab(id);

export function closeFrontTab() {
  const id = currentTabs().selectedId;
  if (id) closeTabById(id);
}

export const openArchivedTab = (tab: BrowserTab) => reopenArchived(tab);

export const deleteArchivedTab = (tab: BrowserTab) => deleteArchivedTabsById([tab.id]);

export const shareUrl = (url: string, title: string) => quietly(() => shareLink(url, title));
