import { create } from "zustand";
import type { ScrollState } from "../../platform/tabs";
import { useBrowser } from "../browser/store";

export const STRIP_HEIGHT = 20;

export type ToolbarMode = "shown" | "collapsed" | "peek";

type Store = {
  scrolledDown: Record<string, true>;
  peek: Record<string, true>;
};

export const useToolbarAutoHide = create<Store>()(() => ({ scrolledDown: {}, peek: {} }));

const without = (map: Record<string, true>, tabId: string) => {
  if (!map[tabId]) return map;
  const next = { ...map };
  delete next[tabId];
  return next;
};

export function noteScroll(tabId: string, state: ScrollState) {
  useToolbarAutoHide.setState((s) => {
    const peek = without(s.peek, tabId);
    const scrolledDown =
      state === "down" ? (s.scrolledDown[tabId] ? s.scrolledDown : { ...s.scrolledDown, [tabId]: true as const }) : without(s.scrolledDown, tabId);
    return scrolledDown === s.scrolledDown && peek === s.peek ? s : { scrolledDown, peek };
  });
}

export function revealToolbar(tabId: string) {
  useToolbarAutoHide.setState((s) => {
    const scrolledDown = without(s.scrolledDown, tabId);
    const peek = without(s.peek, tabId);
    return scrolledDown === s.scrolledDown && peek === s.peek ? s : { scrolledDown, peek };
  });
}

export function setToolbarPeek(tabId: string, on: boolean) {
  useToolbarAutoHide.setState((s) => {
    if (!!s.peek[tabId] === on) return s;
    return { peek: on ? { ...s.peek, [tabId]: true } : without(s.peek, tabId) };
  });
}

type ToolbarModeInput = {
  enabled: boolean;
  hasPage: boolean;
  scrolledDown: boolean;
  peek: boolean;
  needsBar: boolean;
};

export function toolbarMode(i: ToolbarModeInput): ToolbarMode {
  if (!i.enabled || !i.hasPage || !i.scrolledDown || i.needsBar) return "shown";
  return i.peek ? "peek" : "collapsed";
}

useBrowser.subscribe((s, prev) => {
  if (s.tabs === prev.tabs) return;
  const { scrolledDown, peek } = useToolbarAutoHide.getState();
  const gone: string[] = [];
  for (const id in scrolledDown) if (!s.tabs[id]) gone.push(id);
  for (const id in peek) if (!s.tabs[id]) gone.push(id);
  if (!gone.length) return;
  useToolbarAutoHide.setState((st) => {
    let { scrolledDown: d, peek: p } = st;
    for (const id of gone) {
      d = without(d, id);
      p = without(p, id);
    }
    return { scrolledDown: d, peek: p };
  });
});
