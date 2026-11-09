import { hostOf } from "@ardia/core";
import type { PageEngine } from "../../platform/tabs";
import { dismissPermissions } from "../site/permissions";
import { answerExternalApp } from "../site/prompts";
import { setPageSelection } from "../site/selection";
import { offerSurvivesNavigation } from "../site/verificationCodes";
import { clearEngineOffer, followSiteChoice } from "../engines/actions";
import { revealToolbar } from "../windows/toolbarAutoHide";
import { noteCaptureIndicatorCleared } from "../telemetry/usage";
import { patchPage, pageOf, setPopover } from "./pageState";

export function leftPage(tabId: string, url: string, previousPage: string, engine: PageEngine, inPeek: boolean) {
  if (pageOf(tabId).externalApp && hostOf(url) !== hostOf(previousPage)) answerExternalApp(tabId, false);
  dismissPermissions(tabId);
  setPopover(tabId, null);
  setPageSelection(tabId, null);
  clearEngineOffer(tabId);
  const verificationCode = offerSurvivesNavigation(pageOf(tabId).verificationCode, url);
  patchPage(tabId, { popups: [], passwordPrompt: null, verificationCode, verificationCodesOffered: verificationCode ? [verificationCode.url] : [], crashed: null, status: "" });
  revealToolbar(tabId);
  if (!inPeek) followSiteChoice(tabId, engine, url, previousPage);
}

export function pageEnded(tabId: string) {
  if (!pageOf(tabId).mediaAccess) return;
  noteCaptureIndicatorCleared();
  patchPage(tabId, { mediaAccess: null });
}
