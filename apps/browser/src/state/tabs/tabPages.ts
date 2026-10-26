import { claimLaunchTab, prepareTabTransfer, releaseTabTransfer, type PageEngine } from "../../platform/tabs";
import { isInternalTab } from "../pages/urls";
import { useBrowser } from "../browser/store";
import { changedIds } from "../browser/changes";
import { earlyLaunchTabOn, launchTab } from "./launchTab";
import { engineProfile } from "../browser/model";
import { hasPage } from "./pageSession";
import { tabEngine } from "../engines/engines";
import type { Tab } from "../browser/types";
import { issuedSeq, webviews } from "../../platform/webviews";

export const wantsPage = (t: Tab | undefined): t is Tab => !!t && hasPage(t) && !isInternalTab(t);

const handedOff = new Map<string, string>();

type Handoff = { seq: number | undefined; engine: PageEngine };
const handoffs = new Map<string, Handoff>();

export const isHandedOff = (tabId: string) => handedOff.has(tabId);

export function takeHandOff(tabId: string, engine: PageEngine): Handoff | null {
  const handoff = handoffs.get(tabId);
  if (!handoff || !handedOff.has(tabId)) return null;
  handoffs.delete(tabId);
  handedOff.delete(tabId);
  if (handoff.engine === engine) return handoff;
  releaseTabTransfer(tabId);
  return null;
}

export function handOff(tabId: string, profile: string, engine: PageEngine) {
  handedOff.set(tabId, profile);
  handoffs.set(tabId, { seq: issuedSeq(tabId), engine });
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
      if (tab && before && tab.windowId !== before.windowId && webviews.has(id) && profile === engineProfile(before.profileId)) handOff(id, profile!, tabEngine(s, id));
      const kept = handedOff.get(id);
      if (kept !== undefined && !(wantsPage(tab) && profile === kept)) {
        handedOff.delete(id);
        handoffs.delete(id);
        releaseTabTransfer(id);
      }
    }
  });
}

function claimLaunch() {
  const s = useBrowser.getState();
  const launch = earlyLaunchTabOn() ? launchTab(s, s.ui.focusedWindowId) : null;
  const tab = launch ? s.tabs[launch.id] : undefined;
  const kept = launch && wantsPage(tab) && tab.navigation?.url === launch.url && tabEngine(s, launch.id) === "chromium" ? launch : null;
  if (kept) {
    handedOff.set(kept.id, kept.profile);
    handoffs.set(kept.id, { seq: tab?.navigation?.seq, engine: "chromium" });
  }
  claimLaunchTab(kept?.id ?? "", kept?.url ?? "", kept?.profile ?? "");
}
