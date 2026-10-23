import { claimLaunchTab, prepareTabTransfer, releaseTabTransfer } from "@ardia/ardiacore";
import { isInternalTab } from "../components/pages/urls";
import { useBrowser } from "../store/browser";
import { changedIds } from "../store/changes";
import { earlyLaunchTabOn, launchTab } from "../store/launchTab";
import { engineProfile } from "../store/model";
import type { Tab } from "../store/types";
import { webviews } from "./webviews";

export const wantsPage = (t: Tab | undefined): t is Tab => !!t && !!(t.navigation || t.adoptId || t.requiresAdoption) && !isInternalTab(t);

const handedOff = new Map<string, string>();

export const isHandedOff = (tabId: string) => handedOff.has(tabId);

export function handOff(tabId: string, profile: string) {
  handedOff.set(tabId, profile);
  prepareTabTransfer(tabId);
}

export function startTabPages() {
  claimLaunch();
  useBrowser.subscribe((s, prev) => {
    if (s.tabs === prev.tabs) return;
    for (const id of changedIds(s.tabs, prev.tabs)) {
      const tab = s.tabs[id];
      const before = prev.tabs[id];
      const profile = tab && engineProfile(tab.profileId);
      if (tab && before && tab.windowId !== before.windowId && webviews.has(id) && profile === engineProfile(before.profileId)) handOff(id, profile!);
      const kept = handedOff.get(id);
      if (kept !== undefined && !(wantsPage(tab) && profile === kept)) {
        handedOff.delete(id);
        releaseTabTransfer(id);
      }
    }
  });
}

function claimLaunch() {
  const s = useBrowser.getState();
  const launch = earlyLaunchTabOn() ? launchTab(s, s.ui.focusedWindowId) : null;
  const tab = launch ? s.tabs[launch.id] : undefined;
  const kept = launch && wantsPage(tab) && tab.navigation?.url === launch.url ? launch : null;
  if (kept) handedOff.set(kept.id, kept.profile);
  claimLaunchTab(kept?.id ?? "", kept?.url ?? "", kept?.profile ?? "");
}
