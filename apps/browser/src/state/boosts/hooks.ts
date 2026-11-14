import { useMemo } from "react";
import { useBrowser } from "../browser/store";
import { boostMatchesHost } from "./match";
import { boostsKey, NO_BOOSTS, useBoostStore } from "./store";
import type { Boost } from "./types";

export function useProfileBoosts(profileId: string): Boost[] {
  const key = useBrowser((s) => boostsKey(s, profileId));
  return useBoostStore((s) => s.boostsByProfile[key]) ?? NO_BOOSTS;
}

export function useSiteBoosts(profileId: string, host: string): Boost[] {
  const boosts = useProfileBoosts(profileId);
  return useMemo(() => boosts.filter((boost) => boostMatchesHost(boost, host)), [boosts, host]);
}
