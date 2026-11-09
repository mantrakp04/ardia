import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId } from "../browser/model";
import { shownPageId } from "../peek/peek";
import type { Anchor } from "./store";

type AnchorEntry = { windowId: string; tabId: string; anchor: Anchor };
const toolbarAnchors = new Map<string, AnchorEntry>();
const anchorKey = (windowId: string, tabId: string, slot: string) => `${windowId}|${tabId}|${slot}`;

export const setToolbarAnchor = (windowId: string, tabId: string, slot: string, anchor: Anchor) =>
  void toolbarAnchors.set(anchorKey(windowId, tabId, slot), { windowId, tabId, anchor });

export function dropToolbarAnchor(windowId: string, tabId: string, slot: string, anchor: Anchor) {
  const key = anchorKey(windowId, tabId, slot);
  if (toolbarAnchors.get(key)?.anchor === anchor) toolbarAnchors.delete(key);
}

export function pruneToolbarAnchors(s: BrowserState) {
  if (!toolbarAnchors.size) return;
  for (const [key, entry] of toolbarAnchors) if (!s.windows[entry.windowId] || s.tabs[entry.tabId]?.windowId !== entry.windowId) toolbarAnchors.delete(key);
}

export function toolbarAnchor(windowId: string, extensionId: string, tabId?: string): Anchor {
  const s = useBrowser.getState();
  for (const pane of new Set([tabId ?? shownPageId(s, windowId), activeTabId(s, windowId)])) {
    if (!pane) continue;
    const entry = toolbarAnchors.get(anchorKey(windowId, pane, extensionId)) ?? toolbarAnchors.get(anchorKey(windowId, pane, "*"));
    if (entry) return entry.anchor;
  }
  return { x: 100_000, y: 13, width: 28, height: 28 };
}
