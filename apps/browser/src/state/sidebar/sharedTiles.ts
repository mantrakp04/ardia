import { useMemo } from "react";
import { Animated } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { useBrowser, type BrowserState } from "../browser/store";
import { topAppsShared } from "../pins/topApps";
import { pagerFor } from "../windows/profilePager";

export type SharedSides = { before: boolean; after: boolean };

export function sharedTileSides(s: Pick<BrowserState, "profiles" | "profileOrder">, slot: number): SharedSides {
  const id = s.profileOrder[slot];
  const neighbour = (other: string | undefined) => !!id && !!other && topAppsShared(s, id, other);
  return { before: neighbour(s.profileOrder[slot - 1]), after: neighbour(s.profileOrder[slot + 1]) };
}

export function sharedTilesMotion(pos: Animated.Value, slot: number, width: number, { before, after }: SharedSides) {
  const inputRange = [slot - 1, slot, slot + 1];
  return {
    opacity: pos.interpolate({ inputRange, outputRange: [before ? 0 : 1, 1, after ? 0 : 1], extrapolate: "clamp" }),
    transform: [{ translateX: pos.interpolate({ inputRange, outputRange: [before ? -width : 0, 0, after ? width : 0], extrapolate: "clamp" }) }],
  };
}

export function useSharedTilesStyle(windowId: string, slot: number, width: number, paging: boolean) {
  const { pos } = pagerFor(windowId);
  const [before, after] = useBrowser(
    useShallow((s) => {
      if (!paging) return [false, false] as const;
      const sides = sharedTileSides(s, slot);
      return [sides.before, sides.after] as const;
    }),
  );
  return useMemo(() => (before || after ? sharedTilesMotion(pos, slot, width, { before, after }) : null), [pos, slot, width, before, after]);
}
