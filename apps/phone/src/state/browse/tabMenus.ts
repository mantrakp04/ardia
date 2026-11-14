import { mobileClean } from "@ardia/core/src/mobile";
import { copyText, pressHaptic, shareLink, successHaptic } from "../../platform/system";
import { settled } from "../pages/store";
import { display } from "../search/omnibox";
import { closeTabById, currentTabs, deleteArchivedTabsById } from "../tabs/store";
import { isSyncableUrl, type BrowserTab } from "../tabs/tabModels";
import { recentOtherTabs, tabMenuTitle } from "../tabs/tabsState";
import { showToast } from "../toasts/store";
import { openTab, reopenArchived } from "./store";

export const COPIED_LINK = "Copied URL Without Trackers";

const quietly = (call: () => Promise<unknown>) => void settled(call, undefined);

export const canShareTab = (tab: BrowserTab) => isSyncableUrl(tab.url);

export const tabTitle = (tab: BrowserTab) => tabMenuTitle(tab, display(tab.url).host);

export function copyTabLink(tab: BrowserTab) {
  if (!canShareTab(tab)) return;
  quietly(() => copyText(mobileClean(tab.url)));
  quietly(successHaptic);
  showToast(COPIED_LINK, "link");
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
