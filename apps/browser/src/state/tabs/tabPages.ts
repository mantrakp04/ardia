import { parkedTopAppOwners } from "../pins/topApps";
import { claimLaunchTab, prepareTabTransfer, releaseTabTransfer, type PageEngine } from "../../platform/tabs";
import { isInternalTab } from "../pages/urls";
import { useBrowser } from "../browser/store";
import { changedIds } from "../browser/changes";
import { earlyLaunchTabOn, launchTab } from "./launchTab";
import { engineProfileForSpace, engineProfileIn } from "../browser/model";
import { hasPage, navigationOf } from "./pageSession";
import { tabEngine } from "../engines/engines";
import type { Tab } from "../browser/types";
import { webviews } from "../../platform/webviews";
import { issuedSeq } from "./earlyNavigate";
import { focusedWindowOf } from "../windows/ui";

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
    if (s.tabs === prev.tabs && s.parkedTopApps === prev.parkedTopApps) return;
    const parked = parkedTopAppOwners(s);
    const wasParked = parkedTopAppOwners(prev);
    const ids = new Set([...changedIds(s.tabs, prev.tabs), ...parked.keys(), ...wasParked.keys()]);
    for (const id of ids) {
      const tab = s.tabs[id];
      const before = prev.tabs[id];
      const space = tab && engineProfileForSpace(tab.spaceId);
      const held = parked.get(id);
      if (held) {
        if (before && webviews.has(id)) handOff(id, s.profiles[held.profileId]!.engineId, tabEngine(prev, id));
        continue;
      }
      if (tab && before && (tab.windowId !== before.windowId || tab.spaceId !== before.spaceId) && webviews.has(id) && space === engineProfileIn(prev, before.spaceId)) handOff(id, space!, tabEngine(s, id));
      const kept = handedOff.get(id);
      if (kept !== undefined && !(wantsPage(tab) && space === kept)) {
        handedOff.delete(id);
        handoffs.delete(id);
        releaseTabTransfer(id);
      }
    }
  });
}

function claimLaunch() {
  const s = useBrowser.getState();
  const launch = earlyLaunchTabOn() ? launchTab(s, focusedWindowOf(s)) : null;
  const tab = launch ? s.tabs[launch.id] : undefined;
  const kept = launch && wantsPage(tab) && navigationOf(tab)?.url === launch.url && tabEngine(s, launch.id) === "chromium" ? launch : null;
  if (kept) {
    handedOff.set(kept.id, kept.profile);
    handoffs.set(kept.id, { seq: navigationOf(tab)?.seq, engine: "chromium" });
  }
  claimLaunchTab(kept?.id ?? "", kept?.url ?? "", kept?.profile ?? "");
}
