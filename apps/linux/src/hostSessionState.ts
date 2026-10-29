import type { BrowserState, HydrateData } from "../../browser/src/state/browser/store";
import { cloneSessionValue, sessionItemIdentity, shareSessionValue } from "./hostSessionMerge.ts";

const tables = ["profiles", "windows", "tabs", "groups", "splits", "parkedPins", "pinChoices", "pinSync"] as const;
const lists = ["profileOrder", "windowOrder", "orphanedProfileData", "closedTabs", "closedWindows", "closedGroups", "deletedGroups", "cleanedTabs"] as const;
const transientTabKeys = ["page"];

export function sessionStatePatch(state: BrowserState, local: HydrateData, merged: HydrateData): Partial<BrowserState> {
  const patch: Record<string, unknown> = {};
  for (const field of tables) {
    const current = state[field] as Record<string, unknown>;
    const publicValues = local[field] ?? {};
    const next = cloneSessionValue(merged[field] ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(current)) if (!Object.hasOwn(publicValues, key)) Object.defineProperty(next, key, { value, enumerable: true, writable: true, configurable: true });
    if (field === "tabs" || field === "windows") {
      const transientKeys = field === "tabs" ? transientTabKeys : ["chromeWindow"];
      for (const [key, value] of Object.entries(next)) {
        if (!Object.hasOwn(publicValues, key) && Object.hasOwn(current, key)) continue;
        const saved = { ...(value as Record<string, unknown>) };
        const previous = current[key] as Record<string, unknown> | undefined;
        for (const property of transientKeys) {
          if (previous && Object.hasOwn(previous, property)) saved[property] = previous[property];
          else delete saved[property];
        }
        if (field === "tabs" && !previous) saved.page = { kind: (saved.page as { kind?: unknown } | undefined)?.kind === "asleep" ? "asleep" : "idle" };
        next[key] = saved;
      }
    }
    const shared = shareSessionValue(current, next);
    if (shared !== current) patch[field] = shared;
  }
  for (const field of lists) {
    const current = state[field] as unknown[];
    const publicIds = new Set((local[field] ?? []).map(sessionItemIdentity));
    const next = cloneSessionValue(merged[field] ?? []) as unknown[];
    const ids = new Set(next.map(sessionItemIdentity));
    for (const value of current) {
      const id = sessionItemIdentity(value);
      if (publicIds.has(id) || ids.has(id)) continue;
      ids.add(id);
      next.push(value);
    }
    const shared = shareSessionValue(current, next);
    if (shared !== current) patch[field] = shared;
  }
  const settings = shareSessionValue(state.settings, merged.settings ?? state.settings);
  if (settings !== state.settings) patch.settings = settings;
  return patch as Partial<BrowserState>;
}
