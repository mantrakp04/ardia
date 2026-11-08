import { create } from "zustand";
import type { AppBadge } from "../../platform/tabs";
import { faviconLooksBadged, originOf, unreadCount, unreadInTitle, UNREAD_DOT, type Unread } from "../../lib/unread";
import { useBrowser, type BrowserState } from "../browser/store";
import { hasOwnOrSharedPage, holderOfPage } from "./pageSession";

export type { Unread } from "../../lib/unread";

type AppBadgeSeen = { origin: string; unread: Unread | null };
type FaviconSeen = { origin: string; home: string; badged: boolean };

export const useUnread = create<{ app: Record<string, AppBadgeSeen>; favicon: Record<string, FaviconSeen> }>()(() => ({ app: {}, favicon: {} }));

const liveOnly = <T>(entries: Record<string, T>): Record<string, T> => {
  const tabs = useBrowser.getState().tabs;
  const kept: Record<string, T> = {};
  for (const id in entries) if (tabs[id]) kept[id] = entries[id]!;
  return kept;
};

export function noteAppBadge(tabId: string, { origin, count, flag }: AppBadge) {
  const unread = count !== null ? unreadCount(count) : flag ? UNREAD_DOT : null;
  const was = useUnread.getState().app[tabId];
  if (was && was.origin === origin && sameUnread(was.unread, unread)) return;
  useUnread.setState((u) => ({ app: { ...liveOnly(u.app), [tabId]: { origin, unread } } }));
}

export function noteUnreadFavicon(tabId: string, pageUrl: string, favicon: string) {
  const origin = originOf(pageUrl);
  if (!origin || !favicon) return;
  const was = useUnread.getState().favicon[tabId];
  const next = was && was.origin === origin ? { ...was, badged: faviconLooksBadged(was.home, favicon) } : { origin, home: favicon, badged: false };
  if (was && was.origin === next.origin && was.home === next.home && was.badged === next.badged) return;
  useUnread.setState((u) => ({ favicon: { ...liveOnly(u.favicon), [tabId]: next } }));
}

const sameUnread = (a: Unread | null, b: Unread | null) =>
  a === b || (!!a && !!b && a.kind === b.kind && (a.kind === "dot" || a.label === (b as typeof a).label));

const pageSourceOf = (s: BrowserState, tabId: string) => {
  const t = s.tabs[tabId];
  return t && hasOwnOrSharedPage(t) ? (holderOfPage(t) ?? tabId) : null;
};

type UnreadSources = { title: string; origin: string; app: AppBadgeSeen | undefined; favicon: FaviconSeen | undefined };

export function unreadFrom({ title, origin, app, favicon }: UnreadSources): Unread | null {
  if (!origin) return null;
  if (app && app.origin === origin && app.unread) return app.unread;
  return unreadInTitle(title) ?? (favicon && favicon.badged && favicon.origin === origin ? UNREAD_DOT : null);
}

export function tabUnread(tabId: string): Unread | null {
  const s = useBrowser.getState();
  const source = pageSourceOf(s, tabId);
  const t = s.tabs[tabId];
  if (!source || !t) return null;
  const u = useUnread.getState();
  return unreadFrom({ title: t.title, origin: originOf(t.url), app: u.app[source], favicon: u.favicon[source] });
}

export function useTabUnread(tabId: string): Unread | null {
  const source = useBrowser((s) => pageSourceOf(s, tabId));
  const title = useBrowser((s) => (source ? (s.tabs[tabId]?.title ?? "") : ""));
  const origin = useBrowser((s) => (source ? originOf(s.tabs[tabId]?.url ?? "") : ""));
  const app = useUnread((u) => (source ? u.app[source] : undefined));
  const favicon = useUnread((u) => (source ? u.favicon[source] : undefined));
  return source ? unreadFrom({ title, origin, app, favicon }) : null;
}
