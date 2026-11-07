import { extensionSidePanelUrl } from "../../platform/extensions";
import { useBrowser } from "../browser/store";
import { shownReadyTab, extensionPageUrl, extensionProfile, isPrivate, pageProfile, shownIn, useExtensions, type SidePanel } from "./store";

const wanted = new Map<string, string>();
const fetches = new Map<string, number>();
const opened = new Map<string, number>();
const focusDue = new Map<string, number>();
const lookups = new Map<string, number>();
const waiting = new Map<string, { key: string; focus: () => void }>();
let openings = 0;

const nextFetch = (windowId: string) => {
  const ticket = (fetches.get(windowId) ?? 0) + 1;
  fetches.set(windowId, ticket);
  return ticket;
};

export const wantedSidePanels = () => [...wanted];

export const sidePanelKey = (panel: SidePanel) => `${panel.extensionId}|${panel.pageProfile}|${panel.url}|${panel.opened}`;

export function requestSidePanelFocus(windowId: string, panel: SidePanel, focus: () => void) {
  if (focusDue.get(windowId) !== panel.opened) return;
  if (lookups.has(windowId)) {
    waiting.set(windowId, { key: sidePanelKey(panel), focus });
    return;
  }
  focusDue.delete(windowId);
  focus();
}

function leaveLookup(windowId: string) {
  const left = (lookups.get(windowId) ?? 1) - 1;
  if (left > 0) return void lookups.set(windowId, left);
  lookups.delete(windowId);
  const request = waiting.get(windowId);
  if (!request) return;
  waiting.delete(windowId);
  const shown = useExtensions.getState().sidePanels[windowId];
  if (shown && sidePanelKey(shown) === request.key) requestSidePanelFocus(windowId, shown, request.focus);
}

export function openSidePanel(windowId: string, extensionId: string): Promise<void> {
  if (!shownIn(windowId, extensionId)) return Promise.resolve();
  if (wanted.get(windowId) !== extensionId) {
    openings += 1;
    opened.set(windowId, openings);
    focusDue.set(windowId, openings);
  }
  wanted.set(windowId, extensionId);
  return syncSidePanel(windowId);
}

export function closeSidePanel(windowId: string, extensionId?: string) {
  const id = wanted.get(windowId);
  if (!id || (extensionId && id !== extensionId)) return;
  wanted.delete(windowId);
  opened.delete(windowId);
  focusDue.delete(windowId);
  waiting.delete(windowId);
  nextFetch(windowId);
  if (!useExtensions.getState().sidePanels[windowId]) return;
  useExtensions.setState((e) => {
    const sidePanels = { ...e.sidePanels };
    delete sidePanels[windowId];
    return { sidePanels };
  });
}

export function toggleSidePanel(windowId: string, extensionId: string): Promise<void> | void {
  if (wanted.get(windowId) === extensionId) closeSidePanel(windowId);
  else return openSidePanel(windowId, extensionId);
}

export function closeSidePanelsOf(extensionId: string) {
  for (const [windowId, id] of wanted) if (id === extensionId) closeSidePanel(windowId);
}

export async function syncSidePanel(windowId: string): Promise<void> {
  const extensionId = wanted.get(windowId);
  if (!extensionId) return;
  lookups.set(windowId, (lookups.get(windowId) ?? 0) + 1);
  try {
    await showSidePanel(windowId, extensionId);
  } finally {
    leaveLookup(windowId);
  }
}

async function showSidePanel(windowId: string, extensionId: string): Promise<void> {
  const ticket = nextFetch(windowId);
  const readyTab = shownReadyTab(windowId);
  const shown = useExtensions.getState().sidePanels[windowId];
  if (!readyTab && shown?.extensionId === extensionId) return;
  const ext = shownIn(windowId, extensionId);
  const url = !ext
    ? null
    : readyTab
      ? await extensionSidePanelUrl(readyTab, extensionId)
      : !isPrivate(useBrowser.getState(), windowId) && ext.sidePanel
        ? extensionPageUrl(extensionId, ext.sidePanel)
        : null;
  if (fetches.get(windowId) !== ticket) return;
  if (!url || !shownIn(windowId, extensionId)) return closeSidePanel(windowId);
  const s = useBrowser.getState();
  const panel = { extensionId, profile: extensionProfile(s, windowId), pageProfile: pageProfile(s, windowId), url, opened: opened.get(windowId) ?? 0 };
  const now = useExtensions.getState().sidePanels[windowId];
  if (now && now.extensionId === panel.extensionId && now.url === url && now.profile === panel.profile && now.pageProfile === panel.pageProfile && now.opened === panel.opened) return;
  useExtensions.setState((e) => ({ sidePanels: { ...e.sidePanels, [windowId]: panel } }));
}
