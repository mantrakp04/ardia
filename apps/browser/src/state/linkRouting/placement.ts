import { groupRouteKey, pageLinkRoute, placeExternalLink, placeLinkFrom, type LinkPlacement, type PageLinkRoute, type RoutingWorld } from "../../lib/linkRouting";
import type { BrowserState } from "../browser/store";
import { isSmall, lastActiveProfile } from "../windows/small";

export type LinkSource = { windowId?: string; tabId?: string };

export function routingWorld(s: BrowserState): RoutingWorld {
  return {
    recentProfileId: lastActiveProfile(s),
    hasProfile: (profileId) => !!s.profiles[profileId],
    hasGroup: (profileId, groupKey) =>
      Object.values(s.groups).some((g) => g.profileId === profileId && groupRouteKey(g) === groupKey) ||
      !!s.parkedPins[profileId]?.groups.some((g) => g.id === groupKey),
  };
}

export const placeLinkFromOtherApp = (s: BrowserState, url: string): LinkPlacement => placeExternalLink(s.settings.linkRouting, url, routingWorld(s));

export function placeLinkFromProfile(s: BrowserState, url: string, sourceProfileId: string, from?: LinkSource): LinkPlacement | null {
  if (!s.profiles[sourceProfileId]) return null;
  const placed = placeLinkFrom(s.settings.linkRouting, url, routingWorld(s), sourceProfileId);
  return placed && atPlacement(s, placed, from) ? null : placed;
}

function atPlacement(s: BrowserState, placed: LinkPlacement, from?: LinkSource): boolean {
  if (placed.kind === "little") return isSmall(s, from?.windowId);
  if (placed.kind !== "group" || !from?.tabId) return false;
  return Object.values(s.groups).some((g) => g.profileId === placed.profileId && groupRouteKey(g) === placed.groupKey && g.tabIds.includes(from.tabId!));
}

export function pageLinkRoutes(s: BrowserState): PageLinkRoute[] {
  const world = routingWorld(s);
  return s.settings.linkRouting.routes.flatMap((route) => pageLinkRoute(route, world) ?? []);
}
