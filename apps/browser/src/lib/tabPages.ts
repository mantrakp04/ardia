import { claimLaunchTab, prepareTabTransfer, releaseTabTransfer, type PageEngine } from "@ardia/ardiacore";
import { isInternalTab } from "../components/pages/urls";
import { useBrowser } from "../store/browser";
import { changedIds } from "../store/changes";
import { earlyLaunchTabOn, launchTab } from "../store/launchTab";
import { engineProfile } from "../store/model";
import { tabEngine } from "../store/engines";
import type { Tab } from "../store/types";
import { issuedSeq, webviews } from "./webviews";

export const wantsPage = (t: Tab | undefined): t is Tab => !!t && !!(t.navigation || t.adoptId) && !isInternalTab(t);

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
