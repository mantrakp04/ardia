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

function spaceForProfile(profile: string): string | undefined {
  const s = useBrowser.getState();
  const existing = s.spaceOrder.find((id) => engineProfile(s, id) === profile);
  if (existing) return existing;
  const owner = Object.values(s.profiles).find((owner) => owner.engineId === profile);
  return owner ? s.createSpace({ name: owner.name, profileId: owner.id }) : undefined;
}

function adoptStrayTab(request: Request<"adopt">) {
  const { url, profile } = request;
  const adoptId = asAdoptId(request.adoptId);
  if (!url) return;
  const spaceId = spaceForProfile(profile);
  if (!spaceId) return;
  const s = useBrowser.getState();
  const ofSpace = (id: string) => !!s.windows[id] && !(s.windows[id]!.kind === "private") && engineProfile(s, s.windows[id]!.spaceId) === profile;
  const windowId = s.ui.focusOrder.find(ofSpace);
  if (windowId) s.newTab(windowId, { url, adoptId, spaceId: s.windows[windowId]!.spaceId, background: false });
  else openWindow({ url, adoptId, spaceId });
}

function openChromeMadeTab(request: Request<"adoptInto">) {
  const { chromeWindow, url, profile, active, focused } = request;
  const adoptId = asAdoptId(request.adoptId);
  const spaceId = spaceForProfile(profile);
  if (!spaceId) return;
  const s = useBrowser.getState();
  const made = Object.values(s.windows).find((w) => w.kind !== "small" && w.chromeWindow === chromeWindow);
  const destination = made && engineProfile(s, made.spaceId) === profile ? made.spaceId : spaceId;
  if (made) return void s.newTab(made.id, { url, adoptId, spaceId: destination, background: !active });
  openWindow({ url, adoptId, spaceId, chromeWindow, background: !focused });
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
  s.createWindow({ spaceId: tab.spaceId, tabIds: [tabId], chromeWindow, background: !focused });
}
