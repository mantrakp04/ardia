import { onAppEvent } from "../../platform/app";
import { captureEscape } from "../../platform/focus";
import { useBrowser } from "../browser/store";
import { dismissZoomPopover } from "../site/zoomBubble";
import { notePopoverClosed } from "../telemetry/usage";
import { focusedWindowOf } from "../windows/ui";
import { popoverOf, setPopover, usePages, type PagePopover } from "./pageState";

const SAME_PRESS_MS = 600;

let pressedAway: { tabId: string; popover: PagePopover; at: number } | null = null;
let started = false;
let capturing = false;

function closePopover(tabId: string) {
  if (popoverOf(tabId) === "zoom") dismissZoomPopover(tabId);
  else setPopover(tabId, null);
}

export function dismissPopoverByPress(tabId: string) {
  const popover = popoverOf(tabId);
  if (!popover) return;
  pressedAway = { tabId, popover, at: Date.now() };
  closePopover(tabId);
  notePopoverClosed("press");
}

export function closedByThisPress(tabId: string, popover: PagePopover, now = Date.now()) {
  const away = pressedAway;
  pressedAway = null;
  return !!away && away.tabId === tabId && away.popover === popover && now - away.at < SAME_PRESS_MS;
}

export function togglePopover(tabId: string, popover: PagePopover) {
  if (closedByThisPress(tabId, popover)) return;
  setPopover(tabId, popoverOf(tabId) === popover ? null : popover);
}

function popoverTabsIn(windowId: string | null): string[] {
  if (!windowId) return [];
  const tabs = useBrowser.getState().tabs;
  const open = usePages.getState().popover;
  return Object.keys(open).filter((id) => open[id] && tabs[id]?.windowId === windowId);
}

const popoverTabsInFocusedWindow = () => popoverTabsIn(focusedWindowOf(useBrowser.getState()));

export function startPopoverEscape() {
  if (started) return;
  started = true;
  const sync = () => {
    const want = popoverTabsInFocusedWindow().length > 0;
    if (want === capturing) return;
    capturing = want;
    captureEscape("popover", want);
  };
  let stopWatchingFocus: (() => void) | null = null;
  usePages.subscribe((s, prev) => {
    if (s.popover === prev.popover) return;
    const anyOpen = Object.values(s.popover).some(Boolean);
    if (anyOpen && !stopWatchingFocus) stopWatchingFocus = useBrowser.subscribe((b, before) => (b.ui !== before.ui || b.tabs !== before.tabs) && sync());
    if (!anyOpen && stopWatchingFocus) {
      stopWatchingFocus();
      stopWatchingFocus = null;
    }
    sync();
  });
  onAppEvent((e) => {
    if (e.type !== "dragEscape") return;
    const open = popoverTabsInFocusedWindow();
    for (const id of open) closePopover(id);
    if (open.length) notePopoverClosed("escape");
  });
}
