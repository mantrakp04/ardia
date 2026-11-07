import type { ArdiaHost } from "./host";
import type { BrowserState, HydrateData } from "../../browser/src/state/browser/store";
import { initialHostSession, linuxSessionShape, snapshotHostSession } from "./hostSession";
import { mergeSession } from "./hostSessionMerge";

export const isLinuxUtility = (id: string) => id === "settings" || id === "import";

export function initialLinuxSession(host: ArdiaHost, saved: HydrateData | null | undefined): HydrateData {
  if (!isLinuxUtility(host.bootstrap.windowId)) return initialHostSession(host, saved);
  return saved ? linuxSessionShape(saved) : {};
}

const utilitySnapshot = (state: BrowserState, canonical: HydrateData): HydrateData => ({ ...snapshotHostSession(state), focusedWindowId: canonical.focusedWindowId, lastProfileId: canonical.lastProfileId });

export function createUtilitySessionSnapshot(initial: BrowserState, saved: HydrateData) {
  let baseline = utilitySnapshot(initial, saved);
  let previousCanonical = saved;
  return (state: BrowserState, canonical: HydrateData): HydrateData => {
    if (canonical !== previousCanonical) {
      baseline = mergeSession(previousCanonical, canonical, baseline);
      previousCanonical = canonical;
    }
    return mergeSession(baseline, utilitySnapshot(state, canonical), canonical);
  };
}

let flushSession: (() => Promise<void>) | undefined;
export const setSessionFlush = (flush: () => Promise<void>) => void (flushSession = flush);
export const flushLinuxSession = () => flushSession ? flushSession() : Promise.reject(new Error("Session persistence is not ready"));

export type WindowDeparture = { base: HydrateData; session: HydrateData };
let departure: { departure(windowId: string): WindowDeparture } | undefined;
export const setSessionDeparture = (next: { departure(windowId: string): WindowDeparture }) => void (departure = next);
export const linuxWindowDeparture = (windowId: string) => departure?.departure(windowId);
