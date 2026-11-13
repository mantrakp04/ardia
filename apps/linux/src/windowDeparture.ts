import type { StoreApi } from "zustand";
import type { BrowserState } from "../../browser/src/state/browser/store";
import { settle, SettleDidNotConverge } from "../../browser/src/state/browser/settle";
import { createWindowsSlice } from "../../browser/src/state/windows/windows";

function settled(next: BrowserState, prev: BrowserState): BrowserState {
  try {
    return settle(next, prev);
  } catch (error) {
    if (error instanceof SettleDidNotConverge) return error.settled;
    throw error;
  }
}

export function windowDeparture(state: BrowserState, windowId: string): BrowserState {
  let next = state;
  const set = (patch: Partial<BrowserState> | ((s: BrowserState) => Partial<BrowserState>)) => {
    next = { ...next, ...(typeof patch === "function" ? patch(next) : patch) };
  };
  createWindowsSlice(set as StoreApi<BrowserState>["setState"], () => next, {} as StoreApi<BrowserState>).closeWindow(windowId);
  return next === state ? state : settled(next, state);
}
