import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId, isIncognitoProfile } from "../browser/model";
import { usePages } from "../tabs/pageState";
import { focusedWindowOf } from "../windows/ui";
import { eligibleKind, isEligibleTab, shownPage } from "./automationWindows";
import type { AutomationEventName } from "./eventNames";

export type EventSend = (name: AutomationEventName, data: Record<string, unknown>) => void;

const IDLE_SCAN_MS = 30_000;

function tabData(s: BrowserState, tabId: string) {
  const t = s.tabs[tabId]!;
  return { windowId: t.windowId, tabId, profile: t.profileId, ...shownPage(t) };
}

function peekData(s: BrowserState, windowId: string) {
  const peek = s.peeks[windowId]!;
  const t = s.tabs[peek.tabId];
  if (!t || !eligibleKind(s, windowId) || isIncognitoProfile(t.profileId)) return null;
  return { windowId, tabId: peek.tabId, profile: t.profileId, sourceTabId: peek.sourceId, ...shownPage(t) };
}

const splitTabs = (s: BrowserState, id: string) => s.splits[id]!.slots.flatMap((slot) => ("tabId" in slot ? [slot.tabId] : slot.stack));

export function diffMore(s: BrowserState, prev: BrowserState, send: EventSend, wants: ReadonlySet<string>) {
  if (s.windows !== prev.windows) {
    for (const id in s.windows) {
      const w = s.windows[id]!;
      const before = prev.windows[id];
      if (wants.has("littleArdia.opened") && !before && eligibleKind(s, id) === "little") {
        const tabId = activeTabId(s, id);
        send("littleArdia.opened", { windowId: id, profile: w.profileId, ...(tabId && isEligibleTab(s, tabId) ? { tabId, ...shownPage(s.tabs[tabId]!) } : {}) });
      }
      if (wants.has("profile.switched") && before && before.profileId !== w.profileId && eligibleKind(s, id) && eligibleKind(prev, id)) {
        send("profile.switched", { windowId: id, from: before.profileId, profile: w.profileId, profileName: s.profiles[w.profileId]?.name ?? "" });
      }
    }
  }
  if (s.peeks !== prev.peeks) {
    for (const id in s.peeks) if (wants.has("peek.opened") && s.peeks[id]!.tabId !== prev.peeks[id]?.tabId) {
      const data = peekData(s, id);
      if (data) send("peek.opened", data);
    }
    for (const id in prev.peeks) if (wants.has("peek.closed") && s.peeks[id]?.tabId !== prev.peeks[id]!.tabId) {
      const data = peekData(prev, id);
      if (data) send("peek.closed", { ...data, keptAsTab: isEligibleTab(s, prev.peeks[id]!.tabId) });
    }
  }
  if (s.splits !== prev.splits) {
    for (const id in s.splits) if (wants.has("split.created") && !prev.splits[id] && eligibleKind(s, s.splits[id]!.windowId)) {
      send("split.created", { windowId: s.splits[id]!.windowId, splitId: id, tabIds: splitTabs(s, id).filter((t) => isEligibleTab(s, t)) });
    }
    for (const id in prev.splits) if (wants.has("split.closed") && !s.splits[id] && eligibleKind(prev, prev.splits[id]!.windowId)) {
      send("split.closed", { windowId: prev.splits[id]!.windowId, splitId: id });
    }
  }
  if (s.tabs !== prev.tabs) {
    for (const id in s.tabs) {
      const t = s.tabs[id]!;
      const before = prev.tabs[id];
      if (!before || before === t || !isEligibleTab(s, id) || !isEligibleTab(prev, id)) continue;
      if (before.windowId !== t.windowId && wants.has("tab.moved")) send("tab.moved", { ...tabData(s, id), fromWindowId: before.windowId });
      if (!before.pin && t.pin && wants.has("pin.added")) send("pin.added", { ...tabData(s, id), as: t.pin.as });
      if (before.pin && !t.pin && wants.has("pin.removed")) send("pin.removed", tabData(s, id));
    }
  }
  if (s.live !== prev.live && (wants.has("media.started") || wants.has("media.stopped"))) {
    for (const id in s.live) {
      const now = !!s.live[id]?.playingAudio;
      if (now === !!prev.live[id]?.playingAudio || !isEligibleTab(s, id)) continue;
      const name = now ? "media.started" : "media.stopped";
      if (wants.has(name)) send(name, tabData(s, id));
    }
  }
}

function startCrashes(send: EventSend) {
  return usePages.subscribe((pages, prev) => {
    if (pages.pages === prev.pages) return;
    const s = useBrowser.getState();
    for (const id in pages.pages) {
      const crashed = pages.pages[id]!.crashed;
      if (!crashed || prev.pages[id]?.crashed || !isEligibleTab(s, id)) continue;
      send("tab.crashed", { ...tabData(s, id), reason: crashed.reason, status: crashed.status });
    }
  });
}

function shownTabs(s: BrowserState): Set<string> {
  const focused = focusedWindowOf(s);
  const shown = new Set<string>();
  if (focused) {
    const active = activeTabId(s, focused);
    if (active) shown.add(active);
  }
  return shown;
}

function startTabIdle(send: EventSend, thresholds: ReadonlySet<number>) {
  const fired = new Map<number, Set<string>>([...thresholds].map((t) => [t, new Set<string>()]));
  const touched = new Map<string, number>();
  const scan = () => {
    const s = useBrowser.getState();
    const now = Date.now();
    const shown = shownTabs(s);
    for (const id of shown) touched.set(id, now);
    for (const [threshold, idle] of fired) {
      for (const id of idle) {
        if (!s.tabs[id] || !isEligibleTab(s, id)) idle.delete(id);
        else if (shown.has(id)) {
          idle.delete(id);
          send("tab.resumed", { ...tabData(s, id), pinned: !!s.tabs[id]!.pin, idle: threshold });
        }
      }
      for (const id in s.tabs) {
        if (idle.has(id) || shown.has(id) || !isEligibleTab(s, id)) continue;
        const last = Math.max(s.tabs[id]!.lastActiveAt, s.tabs[id]!.restoredAt ?? 0, touched.get(id) ?? 0);
        if (now - last >= threshold * 1000) {
          idle.add(id);
          send("tab.idle", { ...tabData(s, id), pinned: !!s.tabs[id]!.pin, idle: threshold, idleSince: last });
        }
      }
    }
    for (const id of touched.keys()) if (!s.tabs[id]) touched.delete(id);
  };
  const timer = setInterval(scan, IDLE_SCAN_MS);
  const unsubscribe = useBrowser.subscribe((s, prev) => {
    if (s.ui !== prev.ui || s.windows !== prev.windows) scan();
  });
  scan();
  return () => {
    clearInterval(timer);
    unsubscribe();
  };
}

export type StoreFeedNeeds = { events: ReadonlySet<string>; tabIdle: ReadonlySet<number> };

export function startStoreEvents(send: EventSend, needs: StoreFeedNeeds): () => void {
  const stops: (() => void)[] = [];
  const diffing = ["littleArdia.opened", "profile.switched", "peek.opened", "peek.closed", "split.created", "split.closed", "tab.moved", "pin.added", "pin.removed", "media.started", "media.stopped"];
  if (diffing.some((name) => needs.events.has(name))) stops.push(useBrowser.subscribe((s, prev) => diffMore(s, prev, send, needs.events)));
  if (needs.events.has("tab.crashed")) stops.push(startCrashes(send));
  if (needs.tabIdle.size && (needs.events.has("tab.idle") || needs.events.has("tab.resumed"))) stops.push(startTabIdle(send, needs.tabIdle));
  return () => stops.forEach((stop) => stop());
}
