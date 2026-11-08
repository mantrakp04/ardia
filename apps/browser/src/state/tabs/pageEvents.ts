import { hostOf } from "@ardia/core";
import type { PageEngine } from "../../platform/tabs";
import { dismissPermissions } from "../site/permissions";
import { answerExternalApp } from "../site/prompts";
import { setPageSelection } from "../site/selection";
import { clearEngineOffer, followSiteChoice } from "../engines/actions";
import { revealToolbar } from "../windows/toolbarAutoHide";
import { patchPage, pageOf, setPopover } from "./pageState";
import { forgetVaultPage } from "../vaults/menu";

export function leftPage(tabId: string, url: string, previousPage: string, engine: PageEngine, inPeek: boolean) {
  if (pageOf(tabId).externalApp && hostOf(url) !== hostOf(previousPage)) answerExternalApp(tabId, false);
  dismissPermissions(tabId);
  setPopover(tabId, null);
  setPageSelection(tabId, null);
  forgetVaultPage(tabId);
  clearEngineOffer(tabId);
  patchPage(tabId, { popups: [], passwordPrompt: null, crashed: null, status: "" });
  revealToolbar(tabId);
  if (!inPeek) followSiteChoice(tabId, engine, url, previousPage);
}
