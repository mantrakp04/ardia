import type { LinkRoute } from "../../platform/tabs";
import { useBrowser } from "../browser/store";
import { engineProfileForSpace } from "../browser/model";

export type RoutedLinks = { spaceId: string | null; adoptIds: (string | undefined)[] };

export function routedLinks(route: LinkRoute, count: number): RoutedLinks {
  const s = useBrowser.getState();
  const marks = route.adoptIds ?? [];
  const last = s.settings.defaultSpaceId;
  const spaceId = route.profile === undefined ? null : last;
  const compatible = route.profile === engineProfileForSpace(last);
  return {
    spaceId,
    adoptIds: Array.from({ length: count }, (_, i) => (compatible && typeof marks[i] === "string" ? marks[i]! : undefined)),
  };
}
