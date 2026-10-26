import { extensionSidePanelUrl } from "../../platform/extensions";
import { useBrowser } from "../browser/store";
import { shownReadyTab, extensionProfile, isPrivate, pageProfile, shownIn, useExtensions } from "./store";

const wanted = new Map<string, string>();
const fetches = new Map<string, number>();

const nextFetch = (windowId: string) => {
  const ticket = (fetches.get(windowId) ?? 0) + 1;
  fetches.set(windowId, ticket);
  return ticket;
};

export const wantedSidePanels = () => [...wanted];

export function openSidePanel(windowId: string, extensionId: string): Promise<void> {
  if (!shownIn(windowId, extensionId)) return Promise.resolve();
  wanted.set(windowId, extensionId);
  return syncSidePanel(windowId);
}

export function closeSidePanel(windowId: string, extensionId?: string) {
  const id = wanted.get(windowId);
  if (!id || (extensionId && id !== extensionId)) return;
  wanted.delete(windowId);
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
        ? `chrome-extension://${extensionId}/${ext.sidePanel.replace(/^\//, "")}`
        : null;
  if (fetches.get(windowId) !== ticket) return;
  if (!url || !shownIn(windowId, extensionId)) return closeSidePanel(windowId);
  const s = useBrowser.getState();
  const panel = { extensionId, profile: extensionProfile(s, windowId), pageProfile: pageProfile(s, windowId), url };
  const now = useExtensions.getState().sidePanels[windowId];
  if (now && now.extensionId === panel.extensionId && now.url === url && now.profile === panel.profile && now.pageProfile === panel.pageProfile) return;
  useExtensions.setState((e) => ({ sidePanels: { ...e.sidePanels, [windowId]: panel } }));
}
