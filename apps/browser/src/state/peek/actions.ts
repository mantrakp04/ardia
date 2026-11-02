import { setPeekModifier, setPeekOtherSiteTabs, setSplitLinkModifier } from "../../platform/pageOptions";
import { hapticTick } from "../../platform/haptics";
import { webviews } from "../../platform/webviews";
import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId } from "../browser/model";
import { splitLinkModifierOf, type PeekModifier, type SplitLinkModifier } from "../settings/settings";
import { MAX_SPLIT_PANES, splitOf, splitTabIdsOf } from "../splits/splits";
import { openSplitPane } from "../splits/actions";
import { showToast } from "../app/toasts";
import { isPeekTab, otherSitePeekTabIds, shownPageId } from "./peek";
import { closeFind } from "../find/actions";

const store = () => useBrowser.getState();
const closers = new Map<string, () => void>();
const expanders = new Map<string, (done: () => void) => void>();

export function registerPeekMotion(windowId: string, close: () => void, expand: (done: () => void) => void) {
  closers.set(windowId, close);
  expanders.set(windowId, expand);
  return () => {
    if (closers.get(windowId) === close) closers.delete(windowId);
    if (expanders.get(windowId) === expand) expanders.delete(windowId);
  };
}

export function dismissPeek(windowId: string) {
  if (!store().peeks[windowId]) return;
  const close = closers.get(windowId);
  if (close) close();
  else finishPeek(windowId, store().peeks[windowId]!.tabId);
}

export function finishPeek(windowId: string, tabId: string) {
  const peek = store().peeks[windowId];
  if (!peek || peek.tabId !== tabId) return;
  store().closePeek(windowId);
}

const focusSoon = (tabId: string) => setTimeout(() => void webviews.get(tabId)?.focus(), 50);

export function openPeekAsTab(windowId: string) {
  const peek = store().peeks[windowId];
  if (!peek) return;
  const promote = () => {
    if (store().peeks[windowId]?.tabId !== peek.tabId) return;
    const id = store().peekToTab(windowId);
    if (!id) return;
    hapticTick();
    focusSoon(id);
  };
  const expand = expanders.get(windowId);
  if (expand) expand(promote);
  else promote();
}

export function openPeekInSplit(windowId: string) {
  const s = store();
  const peek = s.peeks[windowId];
  if (!peek) return;
  if ((splitTabIdsOf(splitOf(s, peek.sourceId))?.length ?? 0) >= MAX_SPLIT_PANES) {
    return showToast(windowId, "Cannot Add New Pane", `Split View can show up to ${MAX_SPLIT_PANES} tabs at once.`);
  }
  const id = s.peekToTab(windowId, { activate: false });
  if (!id) return;
  if (openSplitPane(windowId, { tabId: id, anchorTabId: peek.sourceId, side: "right" })) focusSoon(id);
  else store().activate(id);
}

export function closePeekOnEscape(tabId: string): boolean {
  const s = store();
  const tab = s.tabs[tabId];
  const peek = tab ? s.peeks[tab.windowId] : undefined;
  if (!tab || !peek || (peek.tabId !== tabId && peek.sourceId !== tabId) || s.find[tabId]?.open || s.windowUi[tab.windowId]?.panel.open) return false;
  dismissPeek(tab.windowId);
  return true;
}

export function runPeekCommand(command: string, windowId: string): boolean {
  const s = store();
  const peek = s.peeks[windowId];
  if (!peek) return false;
  if (command === "openFile") {
    openPeekAsTab(windowId);
    return true;
  }
  if (command !== "closeTab" || s.windowUi[windowId]?.panel.open) return false;
  if (s.find[peek.tabId]?.open) closeFind(peek.tabId);
  else dismissPeek(windowId);
  return true;
}

let started = false;

export function startPeeks() {
  if (started) return;
  started = true;
  let sent: PeekModifier | null = null;
  let sentSplit: SplitLinkModifier | null = null;
  let sentSites: string | null = null;
  let read: { tabs: BrowserState["tabs"]; groups: BrowserState["groups"]; on: boolean } | null = null;
  const sync = () => {
    const s = store();
    const modifier = s.settings.peekModifier;
    if (modifier !== sent) void setPeekModifier((sent = modifier));
    const split = splitLinkModifierOf(s.settings);
    if (split !== sentSplit) void setSplitLinkModifier((sentSplit = split));
    const on = s.settings.peekLinksToOtherSites;
    if (read && read.tabs === s.tabs && read.groups === s.groups && read.on === on) return;
    read = { tabs: s.tabs, groups: s.groups, on };
    const ids = otherSitePeekTabIds(s);
    const key = ids.join("\n");
    if (key === sentSites) return;
    sentSites = key;
    void setPeekOtherSiteTabs(ids);
  };
  sync();
  useBrowser.subscribe(sync);
  useBrowser.subscribe(bumpOnFirstLoad);
  useBrowser.subscribe(refocusAfterClose);
}

function refocusAfterClose(s: BrowserState, prev: BrowserState) {
  if (s.peeks === prev.peeks) return;
  for (const [windowId, peek] of Object.entries(prev.peeks)) {
    if (s.peeks[windowId]?.tabId === peek.tabId || s.tabs[peek.tabId]) continue;
    if (s.tabs[peek.sourceId] && activeTabId(s, windowId) === peek.sourceId) void webviews.get(peek.sourceId)?.focus();
  }
}

const loading = new Set<string>();
const loaded = new Set<string>();

function bumpOnFirstLoad(s: BrowserState, prev: BrowserState) {
  if (s.peeks === prev.peeks && s.live === prev.live) return;
  const shown = new Set(Object.values(s.peeks).map((p) => p.tabId));
  for (const id of [...loading, ...loaded]) if (!shown.has(id)) (loading.delete(id), loaded.delete(id));
  for (const id of shown) {
    if (loaded.has(id)) continue;
    if (s.live[id]?.isLoading) loading.add(id);
    else if (loading.has(id)) {
      loading.delete(id);
      loaded.add(id);
      hapticTick();
    }
  }
}

export const currentShownPageId = (windowId: string) => shownPageId(useBrowser.getState(), windowId);
