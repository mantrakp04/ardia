import { onAppEvent } from "../../platform/app";
import { onWindowEvent } from "../../platform/windows";
import { webviews } from "../../platform/webviews";
import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId } from "../browser/model";
import { isEmptyCardTab, NEW_TAB_BAR_POLICY, newTabOpensBar } from "./newTabBarPolicy";
import { isSmall } from "../windows/small";
import type { NewTabTarget } from "../browser/types";

export { isEmptyCardTab };

const store = () => useBrowser.getState();
const IN_LIST: NewTabTarget = { kind: "list" };

function barTarget(s: BrowserState, windowId: string, target: NewTabTarget): NewTabTarget {
  if (target.kind !== "list") return target;
  const active = activeTabId(s, windowId);
  return active && isEmptyCardTab(s, s.tabs[active]) ? { kind: "into", tabId: active } : target;
}

function barOpensHere(s: BrowserState, windowId: string): boolean {
  return newTabOpensBar(s) && !!s.windows[windowId] && !isSmall(s, windowId);
}

export function showNewTabBar(windowId: string, target: NewTabTarget = IN_LIST): boolean {
  const s = store();
  if (!barOpensHere(s, windowId)) return false;
  s.openPanel(windowId, "", barTarget(s, windowId, target));
  return true;
}

export function toggleNewTabBar(windowId: string, target: NewTabTarget = IN_LIST): boolean {
  const s = store();
  if (!barOpensHere(s, windowId)) return false;
  if (s.windowUi[windowId]?.panel.newTab) closeNewTabBar(windowId);
  else s.openPanel(windowId, "", barTarget(s, windowId, target));
  return true;
}

export function closeNewTabBar(windowId: string) {
  const s = store();
  if (!s.windowUi[windowId]?.panel.open) return;
  s.closePanel(windowId);
  const active = activeTabId(store(), windowId);
  if (active && store().tabs[active]?.url) void webviews.get(active)?.focus();
}

export function openFromNewTabBar(windowId: string, target: NewTabTarget, url: string) {
  const s = store();
  if (!url || !s.windows[windowId] || !s.windowUi[windowId]?.panel.newTab) return;
  s.closePanel(windowId);
  const into = target.kind === "into" ? s.tabs[target.tabId] : undefined;
  if (into && into.windowId === windowId && isEmptyCardTab(s, into)) return store().navigate(into.id, url);
  const group = target.kind === "group" ? s.groups[target.groupId] : undefined;
  if (group && group.windowId === windowId && group.profileId === s.windows[windowId]!.profileId) {
    const id = store().newTabInGroup(group.id);
    if (!id) return;
    store().navigate(id, url);
    return store().activate(id);
  }
  store().newTab(windowId, { url, newTabCommand: true });
}

const launchTabs = new Set<string>();
const shownOver = new Set<string>();

export function showOnceOverEmptyCard(windowId: string, tabId: string) {
  if (!NEW_TAB_BAR_POLICY.showOnceOverNewEmptyWindow || shownOver.has(tabId)) return;
  shownOver.add(tabId);
  if (launchTabs.has(tabId) && !NEW_TAB_BAR_POLICY.showOnLaunch) return;
  const s = store();
  if (activeTabId(s, windowId) === tabId && !s.windowUi[windowId]?.panel.open) showNewTabBar(windowId);
}

function dismissBars(except?: string) {
  const s = store();
  for (const [windowId, ui] of Object.entries(s.windowUi)) if (windowId !== except && ui.panel.newTab) s.closePanel(windowId);
}

export function startNewTabBar() {
  for (const id of Object.keys(store().tabs)) launchTabs.add(id);
  if (!NEW_TAB_BAR_POLICY.dismissOnWindowDeactivation) return;
  onAppEvent((e) => {
    if (e.type === "resignActive" || e.type === "screenLocked") dismissBars();
  });
  onWindowEvent((e) => {
    if (e.type === "focus") dismissBars(e.id);
  });
}
