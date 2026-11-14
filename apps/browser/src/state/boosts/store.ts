import { create } from "zustand";
import { readDocument } from "../../platform/documents";
import { parseSaved, unchanged, type Migrations } from "../../lib/savedDocument";
import { useBrowser, type BrowserState } from "../browser/store";
import { incognitoOriginal, isIncognitoProfile } from "../browser/model";
import type { Boost } from "./types";
import { validBoost } from "./valid";

export const BOOSTS_VERSION = 1;
export const BOOSTS_MIGRATIONS: Migrations = { 0: unchanged };

export const useBoostStore = create<{ boostsByProfile: Record<string, Boost[]> }>()(() => ({ boostsByProfile: {} }));

export const NO_BOOSTS: Boost[] = [];

export const boostsDocument = (key: string) => `boosts-${key}.json`;

export const boostsKey = (s: Pick<BrowserState, "profiles">, profileId: string): string => {
  const own = isIncognitoProfile(profileId) ? incognitoOriginal(profileId) : profileId;
  return s.profiles[own]?.dataId ?? own;
};

export const currentBoostsKey = (profileId: string) => boostsKey(useBrowser.getState(), profileId);

export function loadBoosts(key: string): Boost[] {
  const loaded = useBoostStore.getState().boostsByProfile[key];
  if (loaded) return loaded;
  let boosts = NO_BOOSTS;
  try {
    const list = parseSaved(readDocument(boostsDocument(key)), BOOSTS_VERSION, BOOSTS_MIGRATIONS)?.boosts;
    if (Array.isArray(list)) {
      const seen = new Set<string>();
      boosts = list.flatMap((raw) => {
        const id = (raw as { id?: unknown } | null)?.id;
        const boost = typeof id === "string" && id && !seen.has(id) ? validBoost(id, raw) : null;
        if (boost) seen.add(id as string);
        return boost ? [boost] : [];
      });
    }
  } catch (error) {
    console.warn(`[boosts] couldn't read ${boostsDocument(key)}`, error);
  }
  setBoostList(key, boosts);
  return boosts;
}

export const setBoostList = (key: string, boosts: Boost[]) =>
  useBoostStore.setState((s) => ({ boostsByProfile: { ...s.boostsByProfile, [key]: boosts } }));
