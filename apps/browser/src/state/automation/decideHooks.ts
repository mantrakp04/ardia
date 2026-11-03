import { moveCompletedDownload, setApprovedDownloadFolders, setHoldIncomingLinks } from "../../platform/systemSignals";
import { setOpeningGate } from "../tabs/openingGate";
import { setLinkGate, type LinkGateResult, type LinkSourceInfo } from "../littleArdia/linkGate";
import { setPermissionGate } from "../site/permissionGate";
import { cancelAllDecisions } from "./decideSocket";
import { decideLink, decideOpening, decidePermission, type LinkVerdict } from "./decisions";
import { activeHook, decideHooks, onHooksChanged, startHookRules, useHookRules } from "./hookRules";
import { startOmniboxApprovals } from "./omniboxApprovals";
import { startOmniboxHooks } from "./omniboxHooks";
import { startDownloadHooks } from "./downloadHooks";

function linkResult(url: string, verdict: LinkVerdict | null): LinkGateResult {
  if (!verdict) return { url, route: null, decided: true };
  if ("drop" in verdict) return null;
  return { url, route: verdict, decided: true };
}

function gateLink(url: string, source: LinkSourceInfo): LinkGateResult | Promise<LinkGateResult> {
  const opening = decideOpening(url, { tabId: null, windowId: null, profileId: null, via: "external" });
  const route = (verdict: Awaited<typeof opening>): LinkGateResult | Promise<LinkGateResult> => {
    if (verdict && "cancel" in verdict) return null;
    const target = verdict?.url ?? url;
    const linked = decideLink(target, source);
    return linked instanceof Promise ? linked.then((v) => linkResult(target, v)) : linkResult(target, linked);
  };
  return opening instanceof Promise ? opening.then(route) : route(opening);
}

function updateLinkHold() {
  const wanted = [...decideHooks("link.opening"), ...decideHooks("tab.opening")].some(activeHook);
  try {
    setHoldIncomingLinks(wanted, useHookRules.getState().stamp);
  } catch (error) {
    console.warn("[automation] couldn't set the incoming link hold", error);
  }
}

let started = false;

export function startDecideHooks() {
  if (started) return;
  started = true;
  startOmniboxApprovals();
  startHookRules();
  startOmniboxHooks();
  startDownloadHooks({ move: moveCompletedDownload, approveFolders: setApprovedDownloadFolders });
  setOpeningGate((url, context, signal) => decideOpening(url, context, signal));
  setLinkGate(gateLink);
  setPermissionGate((request, signal) => decidePermission(request, signal));
  onHooksChanged(() => {
    cancelAllDecisions();
    updateLinkHold();
  });
  useHookRules.subscribe((s, prev) => {
    if (s.stamp !== prev.stamp) updateLinkHold();
  });
  updateLinkHold();
}
