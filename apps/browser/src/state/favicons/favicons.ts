import { faviconsFor, fetchFavicon, iconTheme, storeFavicon, type IconTheme } from "../../platform/favicons";
import { onHistoryChanged } from "../../platform/history";
import { readDocument, removeDocument } from "../../platform/documents";
import { useEffect } from "react";
import { create } from "zustand";
import { batchStoreUpdates, useBrowser, type BrowserState } from "../browser/store";
import { engineProfile, isIncognitoProfile } from "../browser/model";
import { DEFAULT_PROFILE_ID } from "../settings/settings";
import { webviews } from "../../platform/webviews";

type Icons = {
  pages: Record<string, string | null>;
  srcs: Record<string, string>;
  appearances: Record<string, [string, string]>;
};

export const EMPTY_ICONS: Icons = { pages: {}, srcs: {}, appearances: {} };
const APPEARANCE_SWAP_MS = 5000;
const MAX_ICONS = 3000;
const LOOKUP_DELAY_MS = 16;
const LOOKUP_BATCH = 200;
let appearanceChangedAt = -Infinity;

export type Favicons = {
  profiles: Record<string, Icons>;
  themes: Record<string, IconTheme | null>;
};

export const useFavicons = create<Favicons>()(() => ({ profiles: {}, themes: {} }));

export const knownFaviconTheme = (uri: string) => useFavicons.getState().themes[uri];

export const cacheKey = (profileId: string) => (isIncognitoProfile(profileId) ? profileId : engineProfile(profileId));
export const pageKey = (url: string) => url.replace(/#.*$/, "");
const siteOf = (url: string) => /^[a-z][\w+.-]*:\/\/[^/?#]*/i.exec(url)?.[0].toLowerCase() ?? "";
export const faviconOutlived = (iconPage: string | null, url: string) => !!iconPage && !!url && siteOf(iconPage) !== siteOf(url);

type Change = (f: Favicons) => Favicons;
const FLUSH_MS = 16;
const changes: Change[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function queue(change: Change, now = false) {
  changes.push(change);
  if (now) flush();
  else flushTimer ??= setTimeout(flush, FLUSH_MS);
}

function flush() {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  const all = changes.splice(0);
  if (all.length) batchStoreUpdates(() => useFavicons.setState((f) => all.reduce((s, change) => change(s), f)));
}

function update(key: string, change: (icons: Icons) => Icons, now = false) {
  queue((f) => {
    const before = f.profiles[key] ?? EMPTY_ICONS;
    const after = change(before);
    return after === before ? f : { ...f, profiles: { ...f.profiles, [key]: after } };
  }, now);
}

const capped = <T,>(map: Record<string, T>, key: string, value: T): Record<string, T> =>
  Object.keys(map).length >= MAX_ICONS ? { [key]: value } : { ...map, [key]: value };

let watching = false;
let touched: Set<string> | null = new Set();
const touch = (page: string) => void (watching && touched?.add(page));
const touchAll = () => void (touched = null);

const queued = new Map<string, Set<string>>();
const writes = new Map<string, number>();
let lookupsInFlight = 0;
const wrote = (key: string, page: string) => void (lookupsInFlight && writes.set(`${key}|${page}`, (writes.get(`${key}|${page}`) ?? 0) + 1));
const asked = new Set<string>();
let lookupTimer: ReturnType<typeof setTimeout> | undefined;

function ask(key: string, page: string) {
  if (isIncognitoProfile(key) || asked.has(`${key}|${page}`)) return;
  asked.add(`${key}|${page}`);
  if (!queued.has(key)) queued.set(key, new Set());
  queued.get(key)!.add(page);
  lookupTimer ??= setTimeout(lookUp, LOOKUP_DELAY_MS);
}

function lookUp() {
  lookupTimer = undefined;
  const batches = [...queued];
  queued.clear();
  for (const [key, pages] of batches) {
    const all = [...pages];
    for (let i = 0; i < all.length; i += LOOKUP_BATCH) lookUpPages(key, all.slice(i, i + LOOKUP_BATCH));
  }
}

function lookUpPages(key: string, list: string[]) {
  const started = list.map((page) => writes.get(`${key}|${page}`));
  lookupsInFlight++;
  void faviconsFor(key, list)
    .then((found) =>
      update(key, (icons) => {
        let next: Record<string, string | null> | undefined;
        for (const [i, page] of list.entries()) {
          if (writes.get(`${key}|${page}`) !== started[i]) continue;
          const uri = found.pages.get(page)?.uri ?? null;
          if (icons.pages[page] === uri) continue;
          next ??= { ...icons.pages };
          next[page] = uri;
          touch(page);
        }
        return next ? { ...icons, pages: next } : icons;
      }, true),
    )
    .catch((error) => {
      for (const page of list) asked.delete(`${key}|${page}`);
      console.warn("[favicons] lookup failed", error);
    })
    .finally(() => {
      if (--lookupsInFlight === 0) writes.clear();
    });
}

const inflight = new Map<string, Promise<string | null>>();

export function noteFavicon(tabId: string, src: string) {
  const tab = useBrowser.getState().tabs[tabId];
  if (!tab?.url || !src) return;
  const key = cacheKey(tab.profileId);
  const page = pageKey(tab.url);
  const known = useFavicons.getState().profiles[key]?.srcs[src];
  if (known) return remember(key, page, src, known);
  const handle = webviews.get(tabId);
  if (!handle) return;
  const id = `${key}|${src}`;
  let pending = inflight.get(id);
  if (!pending) {
    pending = handle
      .downloadFavicon(src)
      .then((image) => image?.uri ?? null)
      .catch(() => null);
    inflight.set(id, pending);
    void pending.finally(() => inflight.delete(id));
  }
  void pending.then((uri) => uri && remember(key, page, src, uri));
}

function remember(key: string, page: string, src: string, uri: string) {
  const icons = changes.length ? undefined : useFavicons.getState().profiles[key];
  if (icons && icons.pages[page] === uri && icons.srcs[src] === uri) return;
  const dark = useBrowser.getState().ui.appDark;
  const swapped = Date.now() - appearanceChangedAt < APPEARANCE_SWAP_MS;
  wrote(key, page);
  update(key, (icons) => {
    const previous = icons.pages[page];
    if (previous === uri && icons.srcs[src] === uri) return icons;
    let appearances = icons.appearances;
    if (swapped && previous && previous !== uri) appearances = { ...appearances, [page]: dark ? [previous, uri] : [uri, previous] };
    const startsOver = Object.keys(icons.pages).length >= MAX_ICONS;
    if (startsOver) touchAll();
    else touch(page);
    const pages = startsOver ? { [page]: uri } : { ...icons.pages, [page]: uri };
    return { pages, srcs: icons.srcs[src] === uri ? icons.srcs : capped(icons.srcs, src, uri), appearances };
  });
}

export type KnownFavicon = { page: string; icon: string; png: string };

export function adoptFavicons(profileId: string, known: KnownFavicon[]) {
  if (isIncognitoProfile(profileId) || !known.length) return;
  const key = cacheKey(profileId);
  const found = new Map(known.map((f) => [pageKey(f.page), f]));
  for (const page of found.keys()) wrote(key, page);
  update(key, (icons) => {
    const fresh = [...found].filter(([page]) => !icons.pages[page]);
    if (!fresh.length) return icons;
    const startsOver = Object.keys(icons.pages).length + fresh.length > MAX_ICONS;
    if (startsOver) touchAll();
    const pages: Record<string, string | null> = startsOver ? {} : { ...icons.pages };
    for (const [page, f] of fresh) {
      pages[page] = `data:image/png;base64,${f.png}`;
      touch(page);
    }
    return { ...icons, pages };
  }, true);
  void (async () => {
    for (const [page, f] of found) await storeFavicon(key, page, f.icon, f.png).catch(() => null);
  })();
}

const failedFetches = new Set<string>();

function fetchMissing(profileId: string, url: string, src: string) {
  const key = cacheKey(profileId);
  if (isIncognitoProfile(profileId) || !/^https?:/i.test(src)) return;
  const id = `${key}|${src}`;
  if (inflight.has(id) || failedFetches.has(id)) return;
  const pending = fetchFavicon(src, key, pageKey(url))
    .then((image) => image?.uri ?? null)
    .catch(() => null);
  inflight.set(id, pending);
  void pending.then((uri) => {
    inflight.delete(id);
    if (uri) remember(key, pageKey(url), src, uri);
    else failedFetches.add(id);
  });
}

export function faviconFailed(profileId: string, uri: string) {
  update(cacheKey(profileId), (icons) => {
    if (!Object.values(icons.pages).includes(uri) && !Object.values(icons.srcs).includes(uri)) return icons;
    touchAll();
    return {
      pages: Object.fromEntries(Object.entries(icons.pages).map(([page, u]) => [page, u === uri ? null : u])),
      srcs: Object.fromEntries(Object.entries(icons.srcs).filter(([, u]) => u !== uri)),
      appearances: icons.appearances,
    };
  });
}

export type ResolvedFavicon = { uri: string; profileId: string };

function lookupIn(key: string, url: string, src: string | null | undefined): string | undefined {
  const icons = useFavicons.getState().profiles[key];
  if (!icons) return undefined;
  const page = pageKey(url);
  const pair = icons.appearances[page];
  if (pair) return pair[useBrowser.getState().ui.appDark ? 1 : 0];
  return (src ? icons.srcs[src] : undefined) ?? icons.pages[page] ?? undefined;
}

function lookupOrder(profileId?: string): string[] {
  if (profileId && !isIncognitoProfile(profileId)) return [profileId];
  return [...new Set([...(profileId ? [profileId] : []), DEFAULT_PROFILE_ID, ...useBrowser.getState().profileOrder])];
}

export function resolveFavicon(url: string, src?: string | null, profileId?: string): ResolvedFavicon | null {
  if (!url) return null;
  for (const id of lookupOrder(profileId)) {
    const uri = lookupIn(cacheKey(id), url, src);
    if (uri) return { uri, profileId: id };
  }
  return null;
}

export const useAppearanceDark = () => useBrowser((s) => s.ui.appDark);

function answered(url: string, profileId?: string): boolean {
  const { profiles } = useFavicons.getState();
  const page = pageKey(url);
  return lookupOrder(profileId).every((id) => isIncognitoProfile(id) || profiles[cacheKey(id)]?.pages[page] !== undefined);
}

type Watcher = { url: string; src?: string | null; profileId?: string; known?: boolean };
const watchers = new Map<string, Set<Watcher>>();

function check(w: Watcher) {
  const known = answered(w.url, w.profileId);
  if (known === w.known) return;
  w.known = known;
  if (!known) for (const id of lookupOrder(w.profileId)) ask(cacheKey(id), pageKey(w.url));
  else if (w.src && w.profileId && !resolveFavicon(w.url, w.src, w.profileId)) fetchMissing(w.profileId, w.url, w.src);
}

function onFavicons(f: Favicons, prev: Favicons) {
  const pages = touched;
  touched = new Set();
  if (f.profiles === prev.profiles) return;
  for (const page of pages ?? [...watchers.keys()]) for (const w of [...(watchers.get(page) ?? [])]) check(w);
}

function watch(w: Watcher) {
  if (!watching) {
    watching = true;
    useFavicons.subscribe(onFavicons);
  }
  const page = pageKey(w.url);
  let set = watchers.get(page);
  if (!set) watchers.set(page, (set = new Set()));
  set.add(w);
  check(w);
  return () => {
    set.delete(w);
    if (!set.size && watchers.get(page) === set) watchers.delete(page);
  };
}

export function useFavicon(url: string, src?: string | null, profileId?: string): ResolvedFavicon | null {
  const key = useFavicons(() => {
    const found = resolveFavicon(url, src, profileId);
    return found ? `${found.profileId} ${found.uri}` : null;
  });
  const missing = !!url && !key;
  const order = missing ? lookupOrder(profileId).join(" ") : "";
  useEffect(() => (missing ? watch({ url, src, profileId }) : undefined), [missing, order, profileId, url, src]);
  const split = key?.indexOf(" ") ?? -1;
  return key ? { profileId: key.slice(0, split), uri: key.slice(split + 1) } : null;
}

const theming = new Set<string>();

export function useFaviconTheme(url: string, src?: string | null, profileId?: string): IconTheme | null | undefined {
  const uri = useFavicons(() => resolveFavicon(url, src, profileId)?.uri ?? null);
  const theme = useFavicons((f) => (uri ? f.themes[uri] : undefined));
  const pending = !!uri && theme === undefined;
  useEffect(() => {
    if (!pending || !uri || theming.has(uri)) return;
    theming.add(uri);
    void iconTheme({ uri })
      .catch(() => null)
      .then((found) => queue((f) => (f.themes[uri] === (found ?? null) ? f : { ...f, themes: capped(f.themes, uri, found ?? null) })))
      .finally(() => theming.delete(uri));
  }, [pending, uri]);
  return theme;
}

function forget(key: string) {
  for (const id of [...asked]) if (id.startsWith(`${key}|`)) asked.delete(id);
  touchAll();
  update(key, () => EMPTY_ICONS, true);
}

export const pruneProfileFavicons = (profileId: string) => forget(cacheKey(profileId));

function removeLegacyFiles(s: Pick<BrowserState, "profiles">) {
  for (const id of Object.keys(s.profiles)) {
    const doc = `favicons-${id}.json`;
    try {
      if (readDocument(doc) === null) continue;
      removeDocument(doc);
    } catch (error) {
      console.warn(`[favicons] couldn't remove ${doc}`, error);
    }
  }
}

export function startFavicons() {
  removeLegacyFiles(useBrowser.getState());
  const history = onHistoryChanged((change) => {
    if (change.kind !== "deleted") return;
    if (change.all) return forget(change.profile);
    const gone = new Set(change.urls.map(pageKey));
    const key = change.profile;
    for (const page of gone) asked.delete(`${key}|${page}`);
    update(key, (icons) => {
      if (!Object.keys(icons.pages).some((page) => gone.has(page))) return icons;
      for (const page of gone) touch(page);
      return { ...icons, pages: Object.fromEntries(Object.entries(icons.pages).filter(([page]) => !gone.has(page))) };
    });
  });
  const stop = useBrowser.subscribe((s, prev) => {
    if (s.ui.appDark !== prev.ui.appDark) appearanceChangedAt = Date.now();
    if (s.windows !== prev.windows && (changes.length || Object.keys(useFavicons.getState().profiles).some(isIncognitoProfile))) {
      const open = new Set(Object.values(s.windows).map((w) => w.profileId));
      for (const t of Object.values(s.tabs)) open.add(t.profileId);
      queue((f) => {
        const gone = Object.keys(f.profiles).filter((id) => isIncognitoProfile(id) && !open.has(id));
        if (gone.length) touchAll();
        return gone.length ? { ...f, profiles: Object.fromEntries(Object.entries(f.profiles).filter(([id]) => !gone.includes(id))) } : f;
      }, true);
    }
  });
  return () => {
    history.remove();
    stop();
  };
}
