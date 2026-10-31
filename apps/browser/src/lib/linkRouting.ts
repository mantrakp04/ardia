export type RouteMatch = "contains" | "equals";

export type RouteDestination =
  | { kind: "profile"; profileId: string }
  | { kind: "group"; profileId: string; groupKey: string }
  | { kind: "recent" }
  | { kind: "little" };

export type LinkRoute = { id: string; match: RouteMatch; pattern: string; destination: RouteDestination };

export type LinkRouting = { routes: LinkRoute[]; defaultDestination: RouteDestination };

export const RECENT: RouteDestination = { kind: "recent" };
export const LITTLE_ARDIA: RouteDestination = { kind: "little" };

export const DEFAULT_LINK_ROUTING: LinkRouting = { routes: [], defaultDestination: LITTLE_ARDIA };

export type LinkPlacement =
  | { kind: "profile"; profileId: string }
  | { kind: "group"; profileId: string; groupKey: string }
  | { kind: "little"; profileId: string };

export type RoutingWorld = {
  recentProfileId: string;
  hasProfile(profileId: string): boolean;
  hasGroup(profileId: string, groupKey: string): boolean;
};

const WEB = /^https?:\/\//i;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function destinationOf(value: unknown): RouteDestination | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case "recent":
      return RECENT;
    case "little":
      return LITTLE_ARDIA;
    case "profile":
      return typeof value.profileId === "string" && value.profileId ? { kind: "profile", profileId: value.profileId } : null;
    case "group":
      return typeof value.profileId === "string" && value.profileId && typeof value.groupKey === "string" && value.groupKey
        ? { kind: "group", profileId: value.profileId, groupKey: value.groupKey }
        : null;
    default:
      return null;
  }
}

function routeOf(value: unknown): LinkRoute | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || typeof value.pattern !== "string") return null;
  if (value.match !== "contains" && value.match !== "equals") return null;
  const destination = destinationOf(value.destination);
  return destination && { id: value.id, match: value.match, pattern: value.pattern, destination };
}

export const isLinkRouting = (value: unknown): value is LinkRouting =>
  isRecord(value) && Array.isArray(value.routes) && value.routes.every((route) => routeOf(route) !== null) && destinationOf(value.defaultDestination) !== null;

export function normalizeLinkRouting(value: unknown): LinkRouting {
  if (!isRecord(value)) return DEFAULT_LINK_ROUTING;
  const ids = new Set<string>();
  const routes: LinkRoute[] = [];
  for (const raw of Array.isArray(value.routes) ? value.routes : []) {
    const route = routeOf(raw);
    if (!route || ids.has(route.id)) continue;
    ids.add(route.id);
    routes.push(route);
  }
  return { routes, defaultDestination: destinationOf(value.defaultDestination) ?? LITTLE_ARDIA };
}

export const sameDestination = (a: RouteDestination, b: RouteDestination): boolean =>
  a.kind === b.kind &&
  (a.kind === "profile" ? a.profileId === (b as typeof a).profileId : true) &&
  (a.kind === "group" ? a.profileId === (b as typeof a).profileId && a.groupKey === (b as typeof a).groupKey : true);

let routeCounter = 0;
export const newLinkRouteId = () => `route-${Date.now().toString(36)}-${(++routeCounter).toString(36)}`;

export const comparable = (text: string) =>
  text
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();

export function routeMatches(route: Pick<LinkRoute, "match" | "pattern">, url: string): boolean {
  const pattern = route.pattern.trim();
  if (!pattern || !WEB.test(url)) return false;
  if (route.match === "contains") return url.toLowerCase().includes(pattern.toLowerCase());
  return comparable(url) === comparable(pattern);
}

export const matchingRoutes = (routing: LinkRouting, url: string): LinkRoute[] => routing.routes.filter((route) => routeMatches(route, url));

export function placeDestination(destination: RouteDestination, world: RoutingWorld, sourceProfileId?: string): LinkPlacement | null {
  switch (destination.kind) {
    case "recent":
      return { kind: "profile", profileId: world.recentProfileId };
    case "little":
      return { kind: "little", profileId: sourceProfileId && world.hasProfile(sourceProfileId) ? sourceProfileId : world.recentProfileId };
    case "profile":
      return world.hasProfile(destination.profileId) ? { kind: "profile", profileId: destination.profileId } : null;
    case "group":
      return world.hasProfile(destination.profileId) && world.hasGroup(destination.profileId, destination.groupKey)
        ? { kind: "group", profileId: destination.profileId, groupKey: destination.groupKey }
        : null;
  }
}

export function placeExternalLink(routing: LinkRouting, url: string, world: RoutingWorld): LinkPlacement {
  for (const route of matchingRoutes(routing, url)) {
    const placed = placeDestination(route.destination, world);
    if (placed) return placed;
  }
  return placeDestination(routing.defaultDestination, world) ?? placeDestination(RECENT, world)!;
}

export function placeLinkFrom(routing: LinkRouting, url: string, world: RoutingWorld, sourceProfileId: string): LinkPlacement | null {
  for (const route of matchingRoutes(routing, url)) {
    const placed = placeDestination(route.destination, world, sourceProfileId);
    if (!placed) continue;
    return placed.kind === "profile" && placed.profileId === sourceProfileId ? null : placed;
  }
  return null;
}

export const withRoute = (routing: LinkRouting, route: LinkRoute): LinkRouting => ({ ...routing, routes: [...routing.routes, route] });

export const withRouteChanged = (routing: LinkRouting, id: string, patch: Partial<Omit<LinkRoute, "id">>): LinkRouting => ({
  ...routing,
  routes: routing.routes.map((route) => (route.id === id ? { ...route, ...patch } : route)),
});

export const withoutRoute = (routing: LinkRouting, id: string): LinkRouting => ({ ...routing, routes: routing.routes.filter((route) => route.id !== id) });

export function withRouteMoved(routing: LinkRouting, id: string, delta: -1 | 1): LinkRouting {
  const from = routing.routes.findIndex((route) => route.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= routing.routes.length) return routing;
  const routes = [...routing.routes];
  [routes[from], routes[to]] = [routes[to]!, routes[from]!];
  return { ...routing, routes };
}

export const withDefaultDestination = (routing: LinkRouting, defaultDestination: RouteDestination): LinkRouting => ({ ...routing, defaultDestination });

export const otherAppsOpenInLittleArdia = (routing: LinkRouting): boolean => routing.defaultDestination.kind === "little";

export const groupRouteKey = (group: { id: string; pinKey?: string | null }): string => group.pinKey ?? group.id;

export type PageLinkRoute = { match: RouteMatch; pattern: string; profile: string | null };

export function pageLinkRoute(route: LinkRoute, world: RoutingWorld): PageLinkRoute | null {
  const pattern = route.match === "equals" ? comparable(route.pattern) : route.pattern.trim().toLowerCase();
  if (!pattern) return null;
  const placed = placeDestination(route.destination, world);
  return placed && { match: route.match, pattern, profile: placed.kind === "profile" ? placed.profileId : null };
}
