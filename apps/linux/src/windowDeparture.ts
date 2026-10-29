import type { StoreApi } from "zustand";
import type { BrowserState } from "../../browser/src/state/browser/store";
import { createWindowsSlice } from "../../browser/src/state/windows/windows";

function closedState(state: BrowserState, windowId: string): BrowserState {
  let next = state;
  const set = (patch: Partial<BrowserState> | ((s: BrowserState) => Partial<BrowserState>)) => {
    next = { ...next, ...(typeof patch === "function" ? patch(next) : patch) };
  };
  createWindowsSlice(set as StoreApi<BrowserState>["setState"], () => next, {} as StoreApi<BrowserState>).closeWindow(windowId);
  return next;
}

export function createWindowDeparture(state: BrowserState, windowId: string) {
  const first = closedState(state, windowId);
  const entry = first.closedWindows === state.closedWindows ? undefined : first.closedWindows.at(-1);
  return (current: BrowserState): BrowserState => {
    const next = closedState(current, windowId);
    if (!entry || next.closedWindows === current.closedWindows) return next;
    return { ...next, closedWindows: [...next.closedWindows.slice(0, -1), entry] };
  };
}
