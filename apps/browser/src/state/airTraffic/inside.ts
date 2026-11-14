import { parseMatchPattern } from "../../lib/matchPattern";
import type { PageLinkRoute } from "../../platform/pageOptions";
import type { BrowserState } from "../browser/store";
import { isIncognitoProfile } from "../browser/model";
import { isSmall } from "../windows/small";
import { groupHolding, hasRouteGroup } from "./groups";
import { linkMatches, targetUsable, type AirTrafficConfig, type AirTrafficRule, type LinkCondition, type OpenAs } from "./rules";

export type InsidePlacement = { profileId: string; open: OpenAs; groupKey: string | null };
export type InsideSource = { profileId: string; windowId?: string; tabId?: string };

type World = Pick<BrowserState, "profiles" | "groups" | "parkedPins" | "windows" | "tabs">;

const usableIn = (s: World) => (profileId: string, groupKey: string | null) =>
  !!s.profiles[profileId] && !isIncognitoProfile(profileId) && (!groupKey || hasRouteGroup(s, profileId, groupKey));

const insideRules = (s: World, config: AirTrafficConfig): AirTrafficRule[] =>
  config.rules.filter((r) => r.enabled && r.inside && r.from === null && targetUsable(r, usableIn(s)));

function alreadyThere(s: World, rule: AirTrafficRule, placed: InsidePlacement, from: InsideSource): boolean {
  if (placed.profileId !== from.profileId) return false;
  if (placed.open === "tab" && !placed.groupKey) return true;
  if (placed.open === "littleArdia" && isSmall(s, from.windowId)) return true;
  const tab = from.tabId ? s.tabs[from.tabId] : undefined;
  if (!tab) return false;
  if (placed.groupKey && groupHolding(s, placed.profileId, placed.groupKey, tab.id)) return true;
  return !!tab.url && linkMatches(rule.when, tab.url);
}

export function placeInside(s: World, config: AirTrafficConfig, url: string, from: InsideSource, asTab = false): InsidePlacement | null {
  const w = from.windowId ? s.windows[from.windowId] : undefined;
  if (w?.kind === "private" || isIncognitoProfile(from.profileId) || !s.profiles[from.profileId]) return null;
  const rule = insideRules(s, config).find((r) => linkMatches(r.when, url));
  if (!rule) return null;
  const placed: InsidePlacement = { profileId: rule.profileId ?? from.profileId, open: asTab ? "tab" : rule.open, groupKey: rule.groupKey ?? null };
  return alreadyThere(s, rule, placed, from) ? null : placed;
}

function pageSpec(when: LinkCondition): PageLinkRoute["spec"] | null {
  if (when.kind === "any") return "any";
  const spec = parseMatchPattern(when.kind === "site" ? `*://*.${when.host}/*` : when.pattern);
  return "error" in spec ? null : spec;
}

export function pageLinkRoutes(s: World, config: AirTrafficConfig): PageLinkRoute[] {
  return insideRules(s, config).flatMap((r) => {
    const spec = pageSpec(r.when);
    return spec ? [{ spec, profile: r.profileId, open: r.open, group: r.groupKey ?? null }] : [];
  });
}
