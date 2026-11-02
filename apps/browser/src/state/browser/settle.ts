import type { BrowserState } from "./store";
import { settleNesting } from "../groups/groups";
import { forgetClosedWindowMutes } from "../tabs/mute";
import { forgetClosedWindowCleanUps } from "../pins/tabCleanup";
import { livePinTables } from "../pins/pinChoices";
import { settlePeeks } from "../peek/peek";
import { pinnedTabsLeaveLive, settlePinHomes } from "../pins/pinHomes";
import { mirrorPins } from "../pins/pinMirror";
import { settleSharedPins } from "../pins/pinShare";
import { settleTileFolders } from "../pins/tileFolders";
import { mirrorTabs, pagesIntoSplits, unshareTabs } from "../tabs/tabShare";

export type SettleStep = (s: BrowserState, prev: BrowserState) => BrowserState | null;

const patched =
  <P extends Partial<BrowserState>>(step: (s: BrowserState, prev: BrowserState) => P | null): SettleStep =>
  (s, prev) => {
    const patch = step(s, prev);
    return patch ? { ...s, ...patch } : null;
  };

export const SETTLE_STEPS: readonly (readonly [string, SettleStep])[] = [
  ["forgetClosedWindowMutes", patched(forgetClosedWindowMutes)],
  ["forgetClosedWindowCleanUps", patched(forgetClosedWindowCleanUps)],
  ["settleNesting", patched((s, prev) => (s.groups === prev.groups && Object.values(s.windows).every((w) => w.tabIds === prev.windows[w.id]?.tabIds) ? null : settleNesting(s)))],
  ["livePinTables", patched(livePinTables)],
  ["settlePeeks", settlePeeks],
  ["settlePinHomes", patched(settlePinHomes)],
  ["unshareTabs", unshareTabs],
  ["pagesIntoSplits", pagesIntoSplits],
  ["settleSharedPins", settleSharedPins],
  ["settleTileFolders", settleTileFolders],
  ["mirrorPins", mirrorPins],
  ["mirrorTabs", mirrorTabs],
  ["pinnedTabsLeaveLive", patched(pinnedTabsLeaveLive)],
];

export const SETTLE_ROUNDS = 8;

export class SettleDidNotConverge extends Error {
  readonly steps: string[];
  readonly settled: BrowserState;
  constructor(steps: string[], settled: BrowserState) {
    super(`The store didn't settle in ${SETTLE_ROUNDS} rounds; still changing: ${steps.join(", ")}`);
    this.steps = steps;
    this.settled = settled;
  }
}

export function settle(next: BrowserState, prev: BrowserState, steps = SETTLE_STEPS): BrowserState {
  let s = next;
  let base = prev;
  for (let round = 0; round < SETTLE_ROUNDS; round++) {
    const input = s;
    const changed: string[] = [];
    for (const [name, step] of steps) {
      const out = step(s, base);
      if (!out || out === s) continue;
      s = out;
      changed.push(name);
    }
    if (!changed.length) return s;
    if (round === SETTLE_ROUNDS - 1) throw new SettleDidNotConverge(changed, s);
    base = input;
  }
  return s;
}
