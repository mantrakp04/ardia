import { hostOf } from "@ardia/core";
import type { PageEngine } from "../../platform/tabs";
import { dismissPermissions } from "../site/permissions";
import { answerExternalApp } from "../site/prompts";
import { setPageSelection } from "../site/selection";
import { clearEngineOffer, followSiteChoice } from "../engines/actions";
import { revealToolbar } from "../windows/toolbarAutoHide";
import { patchPage, pageOf, setPopover } from "./pageState";

export function leftPage(tabId: string, url: string, previousPage: string, engine: PageEngine, inPeek: boolean) {
  if (pageOf(tabId).externalApp && hostOf(url) !== hostOf(previousPage)) answerExternalApp(tabId, false);
  dismissPermissions(tabId);
  setPopover(tabId, null);
  setPageSelection(tabId, null);
  clearEngineOffer(tabId);
  patchPage(tabId, { popups: [], passwordPrompt: null, crashed: null, status: "" });
  revealToolbar(tabId);
  if (!inPeek) followSiteChoice(tabId, engine, url, previousPage);
}
