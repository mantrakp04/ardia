import type { LinkRoute } from "../../platform/tabs";
import { useBrowser } from "../browser/store";
import { engineProfile } from "../browser/model";
import { lastActiveProfile, mainWindowFor } from "../windows/small";

export type RoutedLinks = { profileId: string | null; adoptIds: (string | undefined)[] };

export type LinkChoice = { profileId?: string; littleArdia?: boolean };

export function routedLinks(route: LinkRoute, count: number): RoutedLinks {
  const s = useBrowser.getState();
  const marks = route.adoptIds ?? [];
  const last = lastActiveProfile(s);
  const profileId =
    route.profile === undefined ? null : engineProfile(s, last) === route.profile ? last : (s.profileOrder.find((id) => engineProfile(s, id) === route.profile) ?? null);
  return {
    profileId,
    adoptIds: Array.from({ length: count }, (_, i) => (profileId !== null && typeof marks[i] === "string" ? marks[i]! : undefined)),
  };
}

export function chosenLinks(routed: RoutedLinks, choice: LinkChoice): RoutedLinks {
  const chosen = choice.profileId && useBrowser.getState().profiles[choice.profileId] ? choice.profileId : null;
  if (!chosen || chosen === routed.profileId) return routed;
  return { profileId: chosen, adoptIds: routed.adoptIds.map(() => undefined) };
}

export const windowForProfile = (profileId: string) => mainWindowFor(useBrowser.getState(), profileId);
