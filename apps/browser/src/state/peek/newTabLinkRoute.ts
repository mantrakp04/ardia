import { hostOf } from "@ardia/core";
import type { BrowserState } from "../browser/store";
import type { Settings } from "../settings/settings";
import { linkDestination } from "../../lib/linkWrappers";
import { peekSourceOf, peeksLinksToOtherSites, type SiteLanding } from "./peek";

export type NewTabLinkRoute = Settings["newTabLinksOpenIn"] | "otherSite";

const SITE_LANDING_MS = 8000;

export const siteLanding = (pageUrl: string, then: SiteLanding["then"]): SiteLanding => ({ host: hostOf(pageUrl), until: Date.now() + SITE_LANDING_MS, then });

type RouteState = Pick<BrowserState, "tabs" | "windows" | "groups" | "peeks" | "settings">;

export function leavesSite(url: string, pageUrl: string): boolean {
  const to = hostOf(linkDestination(url));
  return !!to && to !== hostOf(pageUrl);
}

export function newTabLinkRoute(s: RouteState, sourceTabId: string | undefined, url: string): NewTabLinkRoute {
  const source = sourceTabId ? s.tabs[sourceTabId] : undefined;
  const w = source ? s.windows[source.windowId] : undefined;
  if (!source || !w || !sourceTabId || w.kind !== "main" || peekSourceOf(s, sourceTabId) || !/^https?:\/\//i.test(url)) return "tab";
  if (peeksLinksToOtherSites(s, sourceTabId) && leavesSite(url, source.url)) return "otherSite";
  return s.settings.newTabLinksOpenIn;
}
