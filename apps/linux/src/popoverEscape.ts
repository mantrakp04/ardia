import { useBrowser } from "../../browser/src/state/browser/store";
import { usePages } from "../../browser/src/state/tabs/pageState";

const TEXT_ENTRY = "input, textarea, [contenteditable=''], [contenteditable='true']";

type EscapeKey = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "defaultPrevented" | "isComposing">;

type PopoverEscape = {
  target: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  windowId: string;
  menuShown: () => boolean;
  activeElement: () => Pick<Element, "matches"> | null;
};

export function dismissesPopover(event: EscapeKey, typing: boolean, menuOpen: boolean) {
  if (event.key !== "Escape" || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  return !event.defaultPrevented && !event.isComposing && !typing && !menuOpen;
}

export function closeWindowPopovers(windowId: string) {
  const tabs = useBrowser.getState().tabs;
  const open = Object.entries(usePages.getState().popover).filter(([tabId, popover]) => popover && tabs[tabId]?.windowId === windowId);
  if (!open.length) return false;
  usePages.setState((s) => ({ popover: { ...s.popover, ...Object.fromEntries(open.map(([tabId]) => [tabId, null])) } }));
  return true;
}

export function startPopoverEscape({ target, windowId, menuShown, activeElement }: PopoverEscape) {
  const listener = (event: Event) => {
    const key = event as KeyboardEvent;
    if (!dismissesPopover(key, !!activeElement()?.matches(TEXT_ENTRY), menuShown())) return;
    if (closeWindowPopovers(windowId)) key.preventDefault();
  };
  target.addEventListener("keydown", listener);
  return () => target.removeEventListener("keydown", listener);
}
