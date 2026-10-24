import { menuShown, watchMenus } from "@ardia/shell";
import { useBrowser } from "../../store/browser";
import { activeTabId } from "../../store/model";
import { pointerOnCard } from "../sidebar/hover";
import { sidebarUi, useSidebarUi } from "../sidebar/state";
import { usePages } from "./pageState";
import { addressBarInSidebar } from "./windowLayout";

export function peekHeld(windowId: string): boolean {
  if (menuShown()) return true;
  const ui = sidebarUi();
  if (ui.renaming?.windowId === windowId || ui.iconPicker?.windowId === windowId) return true;
  if (ui.hover?.windowId === windowId && pointerOnCard()) return true;
  const s = useBrowser.getState();
  if (s.windowUi[windowId]?.downloadsOpen) return true;
  const tabId = addressBarInSidebar(s, windowId) ? activeTabId(s, windowId) : undefined;
  return !!tabId && !!usePages.getState().popover[tabId];
}

export function watchPeekHolds(changed: () => void): () => void {
  const stops = [watchMenus(changed), useSidebarUi.subscribe(changed), useBrowser.subscribe(changed), usePages.subscribe(changed)];
  return () => stops.forEach((stop) => stop());
}
