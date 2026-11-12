import type { LinkRoute } from "../../platform/tabs";
import { useBrowser } from "../browser/store";
import { engineProfile } from "../browser/model";
import { lastActiveProfile } from "../windows/small";

export type RoutedLinks = { profileId: string | null; adoptIds: (string | undefined)[] };

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
