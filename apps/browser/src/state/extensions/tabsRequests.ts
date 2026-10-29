import type { TabsRequest } from "../../platform/extensions";
import { openWindow } from "../browser/actions";
import { useBrowser } from "../browser/store";
import { engineProfile } from "../browser/model";
import { asAdoptId } from "../tabs/adoptIds";

type Request<A extends TabsRequest["action"]> = Extract<TabsRequest, { action: A }>;

export function openRequestedTab(request: TabsRequest) {
  switch (request.action) {
    case "closeWindow":
      return closeChromeMadeWindow(request);
    case "moveInto":
      return moveIntoChromeMadeWindow(request);
    case "adoptInto":
      return openChromeMadeTab(request);
    case "adopt":
      return adoptStrayTab(request);
  }
}

function adoptStrayTab(request: Request<"adopt">) {
  const { url, profile } = request;
  const adoptId = asAdoptId(request.adoptId);
  if (!url) return;
  const s = useBrowser.getState();
  const ofProfile = (id: string) => !!s.windows[id] && s.windows[id]!.kind !== "private" && engineProfile(s, s.windows[id]!.profileId) === profile;
  const windowId = s.ui.focusOrder.find(ofProfile) ?? s.ui.focusOrder.find((id) => s.windows[id]);
  const profileId = windowId && ofProfile(windowId) ? s.windows[windowId]!.profileId : s.profileOrder.find((p) => engineProfile(s, p) === profile);
  if (profileId) {
    if (windowId && ofProfile(windowId)) s.newTab(windowId, { url, adoptId, profileId, background: false });
    else openWindow({ url, adoptId, profileId });
    return;
  }
  if (windowId) s.newTab(windowId, { url, background: false });
  else openWindow({ url });
}

function openChromeMadeTab(request: Request<"adoptInto">) {
  const { chromeWindow, url, profile, active, focused } = request;
  const adoptId = asAdoptId(request.adoptId);
  const s = useBrowser.getState();
  const made = Object.values(s.windows).find((w) => w.kind !== "small" && w.chromeWindow === chromeWindow);
  if (made) return void s.newTab(made.id, { url, adoptId, profileId: made.profileId, background: !active });
  const profileId = s.profileOrder.find((p) => engineProfile(s, p) === profile);
  if (!profileId) return void openWindow({ url, adoptId });
  openWindow({ url, adoptId, profileId, chromeWindow, background: !focused });
}

function closeChromeMadeWindow({ chromeWindow }: Request<"closeWindow">) {
  const s = useBrowser.getState();
  const made = Object.values(s.windows).find((w) => w.kind !== "small" && w.chromeWindow === chromeWindow);
  if (made) s.closeWindow(made.id);
}

function moveIntoChromeMadeWindow({ chromeWindow, tabId, focused }: Request<"moveInto">) {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  if (!tab) return;
  const made = Object.values(s.windows).find((w) => w.kind !== "small" && w.chromeWindow === chromeWindow);
  if (made) return void s.moveTabsToWindow([tabId], made.id);
  s.createWindow({ profileId: tab.profileId, tabIds: [tabId], chromeWindow, background: !focused });
}
