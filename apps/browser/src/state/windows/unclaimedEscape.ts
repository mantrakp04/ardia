import { onAppEvent } from "../../platform/app";
import { activeTabId } from "../browser/model";
import { useBrowser } from "../browser/store";
import { closeLittleArdiaOnEscape } from "../littleArdia/actions";
import { closePeekOnEscape } from "../peek/actions";
import { closeFolderPanelIn } from "../sidebar/tileFolderUi";
import { popoverOf, setPopover } from "../tabs/pageState";
import type { EscapePressedIn } from "../telemetry/littleArdiaEscapes";

export function escapePressed(tabId: string, pressedIn: EscapePressedIn) {
  if (popoverOf(tabId)) return setPopover(tabId, null);
  if (closeFolderPanelIn(useBrowser.getState().tabs[tabId]?.windowId) || closePeekOnEscape(tabId)) return;
  closeLittleArdiaOnEscape(tabId, pressedIn);
}

export function startUnclaimedEscape() {
  onAppEvent((e) => {
    if (e.type !== "unclaimedEscape") return;
    const tabId = activeTabId(useBrowser.getState(), e.windowId);
    if (tabId) escapePressed(tabId, "window");
  });
}
