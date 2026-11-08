import { useMemo, useSyncExternalStore } from "react";
import type { AppBadge } from "../../platform/tabs";
import { faviconIsOrdinary, faviconLooksBadged, hostOfOrigin, originOf, unreadCount, unreadInTitle, UNREAD_DOT, type Unread } from "../../lib/unread";
import { useBrowser } from "../browser/store";
import type { Tab } from "../browser/types";
import { hasOwnOrSharedPage, holderOfPage } from "./pageSession";
import { useTabValue } from "./tabWatch";

export type { Unread } from "../../lib/unread";

type FaviconSeen = { origin: string; home: string; badged: boolean };
type PagePhase = "running" | "ended" | "reloading";
type PageSignals = { app: ReadonlyMap<string, Unread | null>; favicon: FaviconSeen | null; phase: PagePhase };

const ORIGINS_PER_TAB = 8;
const NO_SIGNALS: PageSignals = { app: new Map(), favicon: null, phase: "running" };

const signals = new Map<string, PageSignals>();
const listeners = new Map<string, Set<() => void>>();

const signalsOf = (tabId: string) => signals.get(tabId) ?? NO_SIGNALS;

function write(tabId: string, next: PageSignals) {
  signals.set(tabId, next);
  for (const listener of [...(listeners.get(tabId) ?? [])]) listener();
}

function watchSignals(tabId: string, listener: () => void): () => void {
  let set = listeners.get(tabId);
  if (!set) listeners.set(tabId, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (!set.size && listeners.get(tabId) === set) listeners.delete(tabId);
  };
}

const sameUnread = (a: Unread | null | undefined, b: Unread | null | undefined) =>
  a === b || (!!a && !!b && a.kind === b.kind && (a.kind === "dot" || a.label === (b as typeof a).label));

export function noteAppBadge(tabId: string, { origin, count, flag }: AppBadge) {
  const unread = count !== null ? unreadCount(count) : flag ? UNREAD_DOT : null;
  const was = signalsOf(tabId);
  if (was.app.has(origin) && sameUnread(was.app.get(origin), unread)) return;
  const app = new Map(was.app);
  app.delete(origin);
  app.set(origin, unread);
  while (app.size > ORIGINS_PER_TAB) app.delete(app.keys().next().value!);
  write(tabId, { ...was, app });
}

export function noteUnreadFavicon(tabId: string, pageUrl: string, favicon: string) {
  const origin = originOf(pageUrl);
  if (!origin || !favicon) return;
  const was = signalsOf(tabId);
  const seen = was.favicon?.origin === origin ? was.favicon : null;
  const home = seen?.home || (faviconIsOrdinary(favicon) ? favicon : "");
  const next = { origin, home, badged: faviconLooksBadged(home, favicon) };
  if (seen && seen.home === next.home && seen.badged === next.badged) return;
  write(tabId, { ...was, favicon: next });
}

export function noteUnreadPageEnded(tabId: string) {
  if (signals.get(tabId)?.phase === "ended") return;
  write(tabId, { app: new Map(), favicon: null, phase: "ended" });
}

export function noteUnreadLoading(tabId: string, isLoading: boolean) {
  const was = signals.get(tabId);
  if (was?.phase === "ended" && isLoading) write(tabId, { ...was, phase: "reloading" });
  else if (was?.phase === "reloading" && !isLoading) write(tabId, { ...was, phase: "running" });
}

export const unreadSignalTabs = () => [...signals.keys()];

export function forgetUnreadIfGone(tabId: string) {
  const t = useBrowser.getState().tabs[tabId];
  if (!t || !hasOwnOrSharedPage(t)) signals.delete(tabId);
}

type TabSide = { source: string | null; origin: string; title: Unread | null };

const tabSide = (tabId: string, t: Tab | undefined): TabSide => {
  if (!t || !hasOwnOrSharedPage(t)) return { source: null, origin: "", title: null };
  const origin = originOf(t.url);
  return { source: holderOfPage(t) ?? tabId, origin, title: origin ? unreadInTitle(t.title, hostOfOrigin(origin)) : null };
};

const sameSide = (a: TabSide, b: TabSide) => a.source === b.source && a.origin === b.origin && sameUnread(a.title, b.title);

export function unreadFrom(side: TabSide, page: PageSignals): Unread | null {
  if (!side.source || !side.origin || page.phase === "ended") return null;
  const app = page.app.get(side.origin);
  if (app) return app;
  if (page.phase !== "running") return null;
  if (side.title) return side.title;
  return page.favicon && page.favicon.badged && page.favicon.origin === side.origin ? UNREAD_DOT : null;
}

export function tabUnread(tabId: string): Unread | null {
  const side = tabSide(tabId, useBrowser.getState().tabs[tabId]);
  return unreadFrom(side, side.source ? signalsOf(side.source) : NO_SIGNALS);
}

const idle = () => () => {};

export function useTabUnread(tabId: string): Unread | null {
  const side = useTabValue(tabId, (t) => tabSide(tabId, t), sameSide);
  const source = side.source;
  const [subscribe, read] = useMemo(() => (source ? [(l: () => void) => watchSignals(source, l), () => signalsOf(source)] : [idle, () => NO_SIGNALS]), [source]);
  const page = useSyncExternalStore(subscribe, read);
  return unreadFrom(side, page);
}
