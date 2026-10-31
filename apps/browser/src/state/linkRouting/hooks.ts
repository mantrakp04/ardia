import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { groupRouteKey, LITTLE_ARDIA, RECENT, type LinkRouting, type RouteDestination } from "../../lib/linkRouting";
import { useBrowser, type BrowserState } from "../browser/store";
import { groupLabel } from "../pins/tabGrouping";
import { lastActiveProfile } from "../windows/small";
import { routingWorld } from "./placement";

const APP = "Ardia";

export type DestinationOption = { value: string; title: string; separatorBefore?: boolean };

export const encodeDestination = (d: RouteDestination): string =>
  d.kind === "profile" ? `profile:${d.profileId}` : d.kind === "group" ? `group:${d.profileId}:${d.groupKey}` : d.kind;

export function decodeDestination(value: string): RouteDestination {
  if (value === "recent") return RECENT;
  if (value === "little") return LITTLE_ARDIA;
  const [kind, profileId = "", ...rest] = value.split(":");
  return kind === "group" ? { kind: "group", profileId, groupKey: rest.join(":") } : { kind: "profile", profileId };
}

type DestinationWorld = Pick<BrowserState, "profiles" | "profileOrder" | "groups" | "parkedPins" | "tabs">;

function destinationOptions(s: DestinationWorld): DestinationOption[] {
  const several = s.profileOrder.length > 1;
  const options: DestinationOption[] = [];
  for (const profileId of s.profileOrder) {
    const profile = s.profiles[profileId];
    if (!profile) continue;
    options.push({ value: encodeDestination({ kind: "profile", profileId }), title: profile.name, separatorBefore: options.length > 0 });
    const seen = new Set<string>();
    const groups = Object.values(s.groups)
      .filter((g) => g.profileId === profileId)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.createdAt - b.createdAt);
    for (const g of groups) {
      const key = groupRouteKey(g);
      if (seen.has(key)) continue;
      seen.add(key);
      const name = groupLabel(s, g);
      options.push({ value: encodeDestination({ kind: "group", profileId, groupKey: key }), title: several ? `${name} (${profile.name})` : name });
    }
    for (const g of s.parkedPins[profileId]?.groups ?? []) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      const name = g.name || "Tab Group";
      options.push({ value: encodeDestination({ kind: "group", profileId, groupKey: g.id }), title: several ? `${name} (${profile.name})` : name });
    }
  }
  options.push({ value: "recent", title: "Most Recent Profile", separatorBefore: true }, { value: "little", title: `Little ${APP}` });
  return options;
}

export const withCurrentDestination = (options: DestinationOption[], current: RouteDestination): DestinationOption[] => {
  const value = encodeDestination(current);
  if (options.some((o) => o.value === value)) return options;
  return [{ value, title: current.kind === "group" ? "A closed tab group" : "A deleted profile" }, ...options];
};

export const useLinkRouting = (): LinkRouting => useBrowser((s) => s.settings.linkRouting);

export function useDestinationOptions(): DestinationOption[] {
  const world = useBrowser(useShallow((s): DestinationWorld => ({ profiles: s.profiles, profileOrder: s.profileOrder, groups: s.groups, parkedPins: s.parkedPins, tabs: s.tabs })));
  return useMemo(() => destinationOptions(world), [world]);
}

export const useRecentProfileId = (): string => useBrowser(lastActiveProfile);

export function describeOtherAppsDestination(s: BrowserState): string {
  const d = s.settings.linkRouting.defaultDestination;
  if (d.kind === "little") return `A link from Discord, Slack or Mail opens in Little ${APP}, a small window of its own. ⌘O moves it into ${APP}; closing it throws it away.`;
  if (d.kind === "recent") return `A link from Discord, Slack or Mail opens as a new tab in the ${APP} window you used last.`;
  const profile = s.profiles[d.profileId];
  if (!profile) return `A link from Discord, Slack or Mail opens as a new tab in the ${APP} window you used last, since that profile is gone.`;
  if (d.kind === "profile") return `A link from Discord, Slack or Mail opens as a new tab in ${profile.name}.`;
  if (!routingWorld(s).hasGroup(d.profileId, d.groupKey)) return `A link from Discord, Slack or Mail opens as a new tab in the ${APP} window you used last, since that tab group is gone.`;
  return `A link from Discord, Slack or Mail opens as a new tab in a tab group of ${profile.name}.`;
}

export const useOtherAppsDestinationDescription = (): string => useBrowser(describeOtherAppsDestination);
