import { extensionSidePanelUrl } from "../../platform/extensions";
import { useBrowser } from "../browser/store";
import { shownReadyTab, extensionPageUrl, extensionProfile, isPrivate, pageProfile, shownIn, useExtensions } from "./store";

const wanted = new Map<string, string>();
const fetches = new Map<string, number>();
const shownTabs = new Map<string, Set<string>>();
const closedTabs = new Map<string, Set<string>>();

const tabsOf = (tabs: Map<string, Set<string>>, windowId: string) => {
  let set = tabs.get(windowId);
  if (!set) tabs.set(windowId, (set = new Set()));
  return set;
};

const nextFetch = (windowId: string) => {
  const ticket = (fetches.get(windowId) ?? 0) + 1;
  fetches.set(windowId, ticket);
  return ticket;
};

export const wantedSidePanels = () => [...wanted];

export const panelTabOpen = (tabId?: string) => !tabId || !!useBrowser.getState().tabs[tabId];

export const panelClosedOnTab = (windowId: string, tabId?: string) => !!tabId && !!closedTabs.get(windowId)?.has(tabId);

export function openSidePanel(windowId: string, extensionId: string): Promise<void> {
  if (!shownIn(windowId, extensionId)) return Promise.resolve();
  if (wanted.get(windowId) !== extensionId) {
    shownTabs.delete(windowId);
    closedTabs.delete(windowId);
  }
  wanted.set(windowId, extensionId);
  const readyTab = shownReadyTab(windowId);
  if (readyTab) closedTabs.get(windowId)?.delete(readyTab);
  return syncSidePanel(windowId);
}

export function closeSidePanel(windowId: string, extensionId?: string) {
  const id = wanted.get(windowId);
  if (!id || (extensionId && id !== extensionId)) return;
  wanted.delete(windowId);
  shownTabs.delete(windowId);
  closedTabs.delete(windowId);
  nextFetch(windowId);
  if (!useExtensions.getState().sidePanels[windowId]) return;
  useExtensions.setState((e) => {
    const sidePanels = { ...e.sidePanels };
    delete sidePanels[windowId];
    return { sidePanels };
  });
}

function hideSidePanel(windowId: string) {
  const now = useExtensions.getState().sidePanels[windowId];
  if (!now) return closeSidePanel(windowId);
  if (now.hidden) return;
  useExtensions.setState((e) => ({ sidePanels: { ...e.sidePanels, [windowId]: { ...now, hidden: true } } }));
}

export function closeSidePanelOnTab(windowId: string) {
  const tabId = useExtensions.getState().sidePanels[windowId]?.tabId;
  if (!tabId) return closeSidePanel(windowId);
  shownTabs.get(windowId)?.delete(tabId);
  tabsOf(closedTabs, windowId).add(tabId);
  const others = [...(shownTabs.get(windowId) ?? [])].some((id) => panelTabOpen(id));
  if (!others) return closeSidePanel(windowId);
  nextFetch(windowId);
  hideSidePanel(windowId);
}

export function toggleSidePanel(windowId: string, extensionId: string): Promise<void> | void {
  const shown = useExtensions.getState().sidePanels[windowId];
  if (wanted.get(windowId) === extensionId && !shown?.hidden) closeSidePanelOnTab(windowId);
  else return openSidePanel(windowId, extensionId);
}

export function closeSidePanelsOf(extensionId: string) {
  for (const [windowId, id] of wanted) if (id === extensionId) closeSidePanel(windowId);
}

export async function syncSidePanel(windowId: string): Promise<void> {
  const extensionId = wanted.get(windowId);
  if (!extensionId) return;
  const ticket = nextFetch(windowId);
  const readyTab = shownReadyTab(windowId);
  const shown = useExtensions.getState().sidePanels[windowId];
  if (!readyTab && shown?.extensionId === extensionId) return;
  if (panelClosedOnTab(windowId, readyTab)) return hideSidePanel(windowId);
  const ext = shownIn(windowId, extensionId);
  const url = !ext
    ? null
    : readyTab
      ? await extensionSidePanelUrl(readyTab, extensionId)
      : !isPrivate(useBrowser.getState(), windowId) && ext.sidePanel
        ? extensionPageUrl(extensionId, ext.sidePanel)
        : null;
  if (fetches.get(windowId) !== ticket) return;
  if (!shownIn(windowId, extensionId)) return closeSidePanel(windowId);
  if (!url) return readyTab ? hideSidePanel(windowId) : closeSidePanel(windowId);
  const s = useBrowser.getState();
  const panel = { extensionId, profile: extensionProfile(s, windowId), pageProfile: pageProfile(s, windowId), url, tabId: readyTab };
  if (readyTab) tabsOf(shownTabs, windowId).add(readyTab);
  const now = useExtensions.getState().sidePanels[windowId];
  if (now && now.extensionId === panel.extensionId && now.url === url && now.profile === panel.profile && now.pageProfile === panel.pageProfile && now.tabId === panel.tabId && !now.hidden) return;
  useExtensions.setState((e) => ({ sidePanels: { ...e.sidePanels, [windowId]: panel } }));
}
