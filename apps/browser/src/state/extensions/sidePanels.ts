import { extensionSidePanelUrl } from "../../platform/extensions";
import { useBrowser } from "../browser/store";
import { shownPageId } from "../peek/peek";
import { shownReadyTab, extensionPageUrl, extensionProfile, isPrivate, pageProfile, shownIn, useExtensions, type SidePanel } from "./store";

const wanted = new Map<string, string>();
const fetches = new Map<string, number>();
const openings = new Map<string, number>();
const focusOwed = new Map<string, { opened: number; page: string | undefined }>();
let lastOpening = 0;
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

const sameCard = (a: SidePanel, b: SidePanel) => a.extensionId === b.extensionId && a.pageProfile === b.pageProfile && a.url === b.url && a.opened === b.opened;

export function takeSidePanelFocus(windowId: string, panel: SidePanel): boolean {
  const owed = focusOwed.get(windowId);
  const { sidePanels, sidePanelLookups } = useExtensions.getState();
  const now = sidePanels[windowId];
  if (owed?.opened !== panel.opened || sidePanelLookups[windowId] || !now || !sameCard(now, panel)) return false;
  focusOwed.delete(windowId);
  return owed.page === shownPageId(useBrowser.getState(), windowId);
}

function countLookup(windowId: string, by: number) {
  useExtensions.setState((e) => {
    const sidePanelLookups = { ...e.sidePanelLookups };
    const left = (sidePanelLookups[windowId] ?? 0) + by;
    if (left > 0) sidePanelLookups[windowId] = left;
    else delete sidePanelLookups[windowId];
    return { sidePanelLookups };
  });
}

export function openSidePanel(windowId: string, extensionId: string): Promise<void> {
  if (!shownIn(windowId, extensionId)) return Promise.resolve();
  const reopening = wanted.get(windowId) !== extensionId;
  if (reopening) {
    shownTabs.delete(windowId);
    closedTabs.delete(windowId);
  }
  if (reopening || useExtensions.getState().sidePanels[windowId]?.hidden) {
    lastOpening += 1;
    openings.set(windowId, lastOpening);
    focusOwed.set(windowId, { opened: lastOpening, page: shownPageId(useBrowser.getState(), windowId) });
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
  openings.delete(windowId);
  focusOwed.delete(windowId);
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
  if (focusOwed.get(windowId)?.page !== shownPageId(useBrowser.getState(), windowId)) focusOwed.delete(windowId);
  countLookup(windowId, 1);
  try {
    await showSidePanel(windowId, extensionId);
  } finally {
    countLookup(windowId, -1);
  }
}

async function showSidePanel(windowId: string, extensionId: string): Promise<void> {
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
  if (!url && readyTab) shownTabs.get(windowId)?.delete(readyTab);
  if (!url) return readyTab ? hideSidePanel(windowId) : closeSidePanel(windowId);
  const s = useBrowser.getState();
  const panel = { extensionId, profile: extensionProfile(s, windowId), pageProfile: pageProfile(s, windowId), url, opened: openings.get(windowId) ?? 0, tabId: readyTab };
  if (readyTab) tabsOf(shownTabs, windowId).add(readyTab);
  const now = useExtensions.getState().sidePanels[windowId];
  if (now && now.extensionId === panel.extensionId && now.url === url && now.profile === panel.profile && now.pageProfile === panel.pageProfile && now.opened === panel.opened && now.tabId === panel.tabId && !now.hidden) return;
  useExtensions.setState((e) => ({ sidePanels: { ...e.sidePanels, [windowId]: panel } }));
}
