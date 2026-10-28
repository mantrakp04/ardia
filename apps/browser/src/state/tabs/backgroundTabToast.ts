import { switchToTab } from "../browser/actions";
import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId, plural } from "../browser/model";
import { hideKeyedToast, showToast, useToasts } from "../splits/actions";
import { peekShown, useDockMotion } from "../windows/dockMotion";

const KEY = "background-tab";
const store = () => useBrowser.getState();

type Announced = { windowId: string; tabIds: string[]; stop(): void };
const announced = new Map<string, Announced>();

function tabsInSight(s: BrowserState, windowId: string): boolean {
  const w = s.windows[windowId];
  if (!w || w.kind === "small") return true;
  return (w.sidebarOpen ?? true) || peekShown(windowId);
}

function otherProfileName(s: BrowserState, windowId: string, tabId: string): string | undefined {
  const w = s.windows[windowId];
  const tab = s.tabs[tabId];
  if (!w || !tab || w.incognito || tab.profileId === w.profileId) return undefined;
  return s.profiles[tab.profileId]?.name;
}

function render(s: BrowserState, a: Announced) {
  const latest = a.tabIds.at(-1);
  if (!latest || !s.tabs[latest]) return;
  const profile = otherProfileName(s, a.windowId, latest);
  const count = a.tabIds.length;
  const title = (count > 1 ? `${plural(count, "New Tab")} Created` : "New Tab Created") + (profile ? ` in ${profile}` : "");
  const shown = useToasts.getState().toasts[a.windowId];
  if (shown?.key === KEY && shown.title === title && shown.tabId === latest) return;
  showToast(a.windowId, title, undefined, {
    key: KEY,
    tabId: latest,
    onPress: () => switchToTab(latest),
    action: { title: "Switch", run: () => switchToTab(latest) },
  });
}

export function announceBackgroundTab(tabId: string | undefined) {
  const s = store();
  const tab = tabId ? s.tabs[tabId] : undefined;
  if (!tabId || !tab) return;
  const { windowId } = tab;
  const elsewhere = !!otherProfileName(s, windowId, tabId);
  if (!elsewhere && tabsInSight(s, windowId)) return;
  const current = announced.get(windowId);
  if (current && useToasts.getState().toasts[windowId]?.key === KEY) {
    current.tabIds = [...current.tabIds.filter((id) => id !== tabId), tabId];
    return render(s, current);
  }
  current?.stop();
  const a: Announced = { windowId, tabIds: [tabId], stop: () => {} };
  let seen: unknown[] = [];
  const stopWatchingStore = useBrowser.subscribe((next) => {
    const now = [next.windows[windowId], next.tabs, next.profiles];
    if (now.every((x, i) => x === seen[i])) return;
    seen = now;
    a.tabIds = a.tabIds.filter((id) => next.tabs[id]?.windowId === windowId);
    const shown = activeTabId(next, windowId);
    const sawIt = !a.tabIds.length || a.tabIds.some((id) => id === shown) || (!a.tabIds.some((id) => otherProfileName(next, windowId, id)) && tabsInSight(next, windowId));
    if (sawIt) return dismiss();
    render(next, a);
  });
  const stopWatchingPeek = useDockMotion.subscribe((m, prev) => {
    if (m.peeks[windowId] !== undefined && prev.peeks[windowId] === undefined && !a.tabIds.some((id) => otherProfileName(store(), windowId, id))) dismiss();
  });
  const stopWatchingToast = useToasts.subscribe((t) => {
    if (t.toasts[windowId]?.key !== KEY) a.stop();
  });
  const dismiss = () => {
    a.stop();
    hideKeyedToast(windowId, KEY);
  };
  a.stop = () => {
    stopWatchingStore();
    stopWatchingPeek();
    stopWatchingToast();
    if (announced.get(windowId) === a) announced.delete(windowId);
  };
  announced.set(windowId, a);
  render(s, a);
}
