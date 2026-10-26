import { dropTabReveals, revealOffered, revealTab } from "../../platform/tabs";
import { useMedia } from "../media/media";
import { pageOf } from "./pageState";
import { useToolbarAutoHide } from "../windows/toolbarAutoHide";
import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId } from "../browser/model";
import { hasPage } from "./pageSession";
import { splitOf } from "../splits/splits";
import type { Tab } from "../browser/types";

const WEB_PAGE = /^(https?|file):/i;
const OFFERED = /^(tab|ardiacore):/;

export type Switch = { tabId: string; offered?: string; over: string } | { tabId: null; over: string };

const hasWebPage = (t: Tab | undefined): t is Tab => !!t && hasPage(t) && WEB_PAGE.test(t.url);

function plainPage(tabId: string): boolean {
  const page = pageOf(tabId);
  return !page.newTabShown && !page.fullscreen && !page.crashed && !page.unresponsive;
}

function revealFor(s: BrowserState, prev: BrowserState, windowId: string, next: string, before: string): Switch | null {
  const w = s.windows[windowId]!;
  const was = prev.windows[windowId]!;
  if (w.profileId !== was.profileId || w.kind === "small") return null;
  if (splitOf(prev, before) || splitOf(s, next) || !plainPage(before) || !plainPage(next)) return null;
  if (Object.keys(useMedia.getState().tabShares).length) return null;
  const tab = s.tabs[next];
  const had = prev.tabs[next];
  if (!hasWebPage(tab) || tab.windowId !== windowId) return null;
  if (hasWebPage(had)) return had.windowId === windowId && was.tabIds.includes(next) ? { tabId: next, over: before } : null;
  if (!had && tab.adoptId && OFFERED.test(tab.adoptId) && hasWebPage(prev.tabs[before]) && !useToolbarAutoHide.getState().scrolledDown[before])
    return { tabId: next, offered: tab.adoptId, over: before };
  return null;
}

export function switchedTabs(s: BrowserState, prev: BrowserState): Switch[] {
  if (s.windows === prev.windows) return [];
  const out: Switch[] = [];
  for (const id in s.windows) {
    const w = s.windows[id]!;
    const was = prev.windows[id];
    if (!was || w === was) continue;
    const next = activeTabId(s, id);
    const before = activeTabId(prev, id);
    if (!before || next === before) continue;
    out.push((next && revealFor(s, prev, id, next, before)) || { tabId: null, over: before });
  }
  return out;
}

export function startTabReveal() {
  useBrowser.subscribe((s, prev) => {
    for (const change of switchedTabs(s, prev)) {
      if (change.tabId === null) dropTabReveals(change.over);
      else if (change.offered) revealOffered(change.offered, change.over);
      else revealTab(change.tabId);
    }
  });
}
