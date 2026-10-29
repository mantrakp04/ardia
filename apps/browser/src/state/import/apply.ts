import { savePassword } from "../../platform/passwords";
import { orWarn } from "../../lib/fallback";
import {
  importModule,
  type BookmarkNode as ImportedNode,
  type Credential,
  type DiaTabsProfile,
  type ImportedFavicon,
  type ImportedTab,
  type ImportKind,
  type ImportResult,
  type SafariExport,
  type SpaceSuggestion,
} from "../../platform/importModule";
import { addGroupsFromDrafts } from "../bookmarks/bookmarkGroups";
import { adoptFavicons } from "../favicons/favicons";
import { bookmarkRoots, type BookmarkDraft } from "../bookmarks/bookmarks";
import type { GroupDraft } from "../groups/draftGroups";
import { useBrowser } from "../browser/store";
import { engineProfile, engineProfileForSpace, isIncognitoSpace, ROW_PIN } from "../browser/model";
import { openPages, pageKey, pinnedPages, tilePages } from "../tabs/pageKeys";
import { withNewTab } from "../tabs/tabs";
import type { ProfileColor } from "../browser/types";
import { setProfileTheme } from "../spaces/themeActions";
import { parseArcTheme } from "./arcTheme";
import { newSpaceLiveFolder } from "../live/engine";
import { live } from "../live/store";
import type { LiveSourceId } from "../live/types";
import { isWebPageUrl, withoutFragment } from "../../lib/url";
import { focusedWindowOf } from "../windows/ui";
import { IDLE } from "../tabs/pageSession";

export type { BrowserProfile, BrowserSource, DiaTabsResult, ImportedExtension, ImportKind, ImportResult, SpaceSummary } from "../../platform/importModule";

export type ImportCounts = { bookmarks: number; history: number; tabs: number; passwords: number; cookies: number; addresses: number; cards: number };

export const emptyCounts = (): ImportCounts => ({ bookmarks: 0, history: 0, tabs: 0, passwords: 0, cookies: 0, addresses: 0, cards: 0 });

const toDraft = (n: ImportedNode): BookmarkDraft =>
  n.type === "url"
    ? { title: n.title || n.url || "", url: n.url ?? "", addedAt: n.dateAdded }
    : { title: n.title, addedAt: n.dateAdded, children: (n.children ?? []).map(toDraft) };

const toGroupDraft = (n: ImportedNode): GroupDraft =>
  n.type === "url"
    ? { title: n.pageTitle ?? n.title, url: n.url ?? "", ...(n.pageTitle ? { customTitle: n.title } : {}) }
    : { title: n.title, children: (n.children ?? []).map(toGroupDraft) };

const LIVE_SOURCES: Partial<Record<NonNullable<ImportedNode["role"]>, LiveSourceId>> = {
  liveGitHubPullRequests: "github",
  liveBitbucketPullRequests: "bitbucket",
};
const liveSourceOf = (n: ImportedNode) => (n.role ? LIVE_SOURCES[n.role] : undefined);
const liveSources = (nodes: ImportedNode[]): LiveSourceId[] =>
  nodes.flatMap((n) => [...(liveSourceOf(n) ? [liveSourceOf(n)!] : []), ...liveSources(n.children ?? [])]);
const withoutLiveFolders = (nodes: ImportedNode[]): ImportedNode[] =>
  nodes.filter((n) => !liveSourceOf(n)).map((n) => (n.children ? { ...n, children: withoutLiveFolders(n.children) } : n));

function importPullRequestsFolders(spaceId: string, nodes: ImportedNode[]) {
  for (const source of new Set(liveSources(nodes))) {
    const have = Object.values(live().folders).some((f) => f.spaceId === spaceId && f.kind === "pullRequests" && f.sources.includes(source));
    if (!have) newSpaceLiveFolder(spaceId, "pullRequests", [source]);
  }
}

const linksOf = (nodes: ImportedNode[]): string[] => nodes.flatMap((n) => (n.type === "url" ? (n.url ? [n.url] : []) : linksOf(n.children ?? [])));

function importFavicons(spaceId: string, favicons: ImportedFavicon[] | undefined, urls: string[]) {
  if (!favicons?.length || !urls.length) return;
  const wanted = new Set(urls.map(withoutFragment));
  adoptFavicons(spaceId, favicons.filter((f) => wanted.has(withoutFragment(f.page))));
}

const linkCount = (nodes: ImportedNode[]): number => nodes.reduce((n, c) => n + (c.type === "url" ? 1 : linkCount(c.children ?? [])), 0);

export function importBookmarks(spaceId: string, root: ImportedNode | undefined, browserName: string): number {
  if (!root?.children?.length) return 0;
  if (!bookmarkRoots(useBrowser.getState(), spaceId)) useBrowser.getState().addBookmarkTree(spaceId, []);
  const roots = bookmarkRoots(useBrowser.getState(), spaceId)!;
  const toolbar = root.children.filter((c) => c.role === "toolbar").flatMap((c) => c.children ?? []);
  const rest = root.children.filter((c) => c.role !== "toolbar");
  const other = rest.flatMap((c) => (c.role === "other" || !c.role ? (c.type === "folder" ? (c.children ?? []) : [c]) : [c]));
  const title = `Imported from ${browserName}`;
  const place = (nodes: ImportedNode[], parentId: string) => {
    if (!nodes.length) return;
    const parent = useBrowser.getState().bookmarks.nodes[parentId];
    const empty = parent?.kind === "folder" && parent.children.length === 0;
    const drafts = nodes.map(toDraft);
    useBrowser.getState().addBookmarkTree(spaceId, empty ? drafts : [{ title, children: drafts }], parentId);
  };
  place(toolbar, roots.bar);
  place(other, roots.other);
  return linkCount([...toolbar, ...other]);
}

export function importHistory(spaceId: string, entries: { url: string; title: string; visits: number; lastVisit: number }[]): number {
  return useBrowser.getState().importHistory(spaceId, entries);
}

async function importPasswords(spaceId: string, credentials: Credential[]): Promise<number> {
  let saved = 0;
  for (const c of credentials) {
    const origin = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)/i.exec(c.realm?.startsWith("http") ? c.realm : c.url)?.[1];
    if (!origin || !c.password) continue;
    if (await savePassword(engineProfile(useBrowser.getState(), spaceId), origin, c.username, c.password).catch(orWarn(false))) saved++;
  }
  return saved;
}

export async function importNative(
  spaceId: string,
  token: string | undefined,
  kinds: ("cookies" | "autofill")[],
  onFailed?: (kind: ImportKind) => void,
): Promise<Pick<ImportCounts, "cookies" | "addresses" | "cards">> {
  const none = { cookies: 0, addresses: 0, cards: 0 };
  if (!token) return none;
  const api = importModule();
  if (!api || !token) return none;
  if (!kinds.length || isIncognitoSpace(spaceId) || useBrowser.getState().spaces[spaceId] === undefined) {
    api.discardImported(token);
    return none;
  }
  try {
    const w = await api.writeImported(token, engineProfile(useBrowser.getState(), spaceId), kinds);
    if (w.cookiesFailed) onFailed?.("cookies");
    if (w.autofillFailed) onFailed?.("autofill");
    return { cookies: w.cookies, addresses: w.addresses, cards: w.cards };
  } catch {
    kinds.forEach((k) => onFailed?.(k));
    return none;
  }
}

function windowFor(spaceId: string): string {
  const s = useBrowser.getState();
  const regular = s.ui.focusOrder.find((id) => s.windows[id] && s.windows[id]!.kind !== "private") ?? s.windowOrder.find((id) => s.windows[id]!.kind !== "private");
  return regular ?? s.createWindow({ spaceId });
}

export function openInWebStore(spaceId: string, urls: string[]) {
  if (!urls.length) return;
  const windowId = windowFor(spaceId);
  urls.forEach((url, i) => useBrowser.getState().newTab(windowId, { url, spaceId, background: i > 0 }));
}

export function importTabs(
  spaceId: string,
  tabs: (Pick<ImportedTab, "url" | "title" | "pinned" | "customTitle"> & { row?: boolean })[],
  group: string | null,
  pinnedAgainst: "anyPin" | "tiles" = "anyPin",
): number {
  const s = useBrowser.getState();
  const pinned = pinnedAgainst === "tiles" ? tilePages(s, spaceId) : pinnedPages(s, spaceId);
  const open = openPages(s, spaceId);
  const usable = tabs.filter((t) => {
    if (!isWebPageUrl(t.url)) return false;
    const seen = t.pinned ? pinned : open;
    const key = pageKey(t.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!usable.length) return 0;
  const windowId = windowFor(spaceId);
  let next = useBrowser.getState();
  const unpinned: string[] = [];
  for (const t of usable) {
    const after = t.pinned ? undefined : unpinned.at(-1);
    const [made, id] = withNewTab(next, windowId, {
      url: t.url,
      spaceId,
      background: true,
      pinned: t.pinned,
      snapshot: { title: t.title, customTitle: t.customTitle ?? null, ...(t.pinned && t.row ? { pin: ROW_PIN } : {}) },
      index: after ? next.windows[windowId]!.tabIds.indexOf(after) + 1 : undefined,
    });
    if (!id) continue;
    next = { ...made, tabs: { ...made.tabs, [id]: { ...made.tabs[id]!, page: IDLE } } };
    if (!t.pinned) unpinned.push(id);
  }
  useBrowser.setState(next);
  if (group && unpinned.length) useBrowser.getState().createGroup(unpinned, { name: group });
  return usable.length;
}

export function importArcSpace(spaceId: string, profile: SpaceSuggestion, favicons?: ImportedFavicon[]): { tabs: number; bookmarks: number; skipped: number } {
  importFavicons(spaceId, favicons, [...linksOf(profile.pinned), ...profile.tabs.map((t) => t.url)]);
  const links = profile.pinned.filter((n) => n.type === "url" && n.url);
  importPullRequestsFolders(spaceId, profile.pinned);
  const folders = withoutLiveFolders(profile.pinned.filter((n) => n.type === "folder"));
  let tabs = importTabs(
    spaceId,
    links.map((n) => ({ url: n.url!, title: n.pageTitle ?? n.title, pinned: true, row: true, customTitle: n.pageTitle ? n.title : undefined })),
    null,
  );
  tabs += importTabs(spaceId, profile.tabs.map((t) => ({ ...t, pinned: false })), "Imported");
  const theme = profile.theme ? parseArcTheme(profile.theme) : null;
  if (theme) setProfileTheme(spaceId, theme);
  if (!folders.length) return { tabs, bookmarks: 0, skipped: 0 };
  const { made, skipped } = addGroupsFromDrafts(spaceId, folders.map(toGroupDraft), windowFor(spaceId));
  const groups = useBrowser.getState().groups;
  tabs += made.reduce((n, id) => n + (groups[id]?.tabIds.length ?? 0), 0);
  return { tabs, bookmarks: 0, skipped };
}

export function importDiaSpace(spaceId: string, profile: DiaTabsProfile, what: { pinned: boolean; open: boolean }, favicons?: ImportedFavicon[]): number {
  importFavicons(spaceId, favicons, [...(what.pinned ? profile.pinned : []), ...(what.open ? profile.tabs : [])].map((t) => t.url));
  const have = openPages(useBrowser.getState(), spaceId);
  const fresh = (tabs: ImportedTab[]) => tabs.filter((t) => !have.has(pageKey(t.url)));
  let n = what.pinned ? importTabs(spaceId, fresh(profile.pinned), null) : 0;
  if (what.open) n += importTabs(spaceId, fresh(profile.tabs).map((t) => ({ ...t, pinned: false })), "Imported");
  return n;
}

export async function applyResult(
  spaceId: string,
  result: ImportResult,
  browserName: string,
  requested: ImportKind[],
  onFailed?: (kind: ImportKind) => void,
): Promise<ImportCounts> {
  const toolbar = (result.bookmarks?.children ?? []).filter((c) => c.role === "toolbar");
  importFavicons(spaceId, result.favicons, [...result.favorites.map((t) => t.url), ...(result.spaces.length ? [] : result.tabs.map((t) => t.url)), ...linksOf(toolbar)]);
  const counts = emptyCounts();
  counts.bookmarks += importBookmarks(spaceId, result.bookmarks, browserName);
  if (result.history.length) counts.history += importHistory(spaceId, result.history);
  const native = (["cookies", "autofill"] as const).filter((k) => requested.includes(k));
  Object.assign(counts, await importNative(spaceId, result.vaultToken, native, onFailed));
  if (result.tabs.length && !result.spaces.length) counts.tabs += importTabs(spaceId, result.tabs, "Imported");
  if (result.favorites.length) counts.tabs += importTabs(spaceId, result.favorites.map((t) => ({ ...t, pinned: true })), null, "tiles");
  if (result.credentials.length) counts.passwords += await importPasswords(spaceId, result.credentials);
  return counts;
}

export async function applySafari(spaceId: string, data: SafariExport, cookies = true, onFailed?: (kind: ImportKind) => void): Promise<ImportCounts> {
  const counts = emptyCounts();
  counts.bookmarks = importBookmarks(spaceId, data.bookmarks, "Safari");
  const history = data.profiles.find((p) => !p.name)?.history ?? data.profiles[0]?.history ?? [];
  counts.history = importHistory(spaceId, history);
  Object.assign(counts, await importNative(spaceId, data.vaultToken, cookies ? ["cookies", "autofill"] : ["autofill"], onFailed));
  if (data.tabs.length) counts.tabs += importTabs(spaceId, data.tabs, "Imported");
  counts.passwords = await importPasswords(spaceId, data.credentials);
  return counts;
}

export function spaceColorFor(hex: string | undefined): ProfileColor | undefined {
  const m = hex && /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return undefined;
  const v = parseInt(m[1]!, 16);
  const [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 0.08) return "neutral";
  let h = 0;
  if (max === r) h = ((g - b) / (max - min) + 6) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h *= 60;
  const hues: [ProfileColor, number][] = [
    ["red", 0],
    ["orange", 25],
    ["yellow", 45],
    ["green", 140],
    ["blue", 210],
    ["purple", 265],
    ["pink", 330],
    ["red", 360],
  ];
  return hues.reduce((best, c) => (Math.abs(c[1] - h) < Math.abs(best[1] - h) ? c : best))[0];
}

export function defaultTarget(): string {
  const s = useBrowser.getState();
  const w = s.windows[focusedWindowOf(s) ?? ""];
  return w && w.kind !== "private" ? w.spaceId : s.settings.defaultSpaceId;
}

export function spaceNamed(name: string): string | undefined {
  const s = useBrowser.getState();
  return s.spaceOrder.find((id) => s.spaces[id]!.name.trim().toLowerCase() === name.trim().toLowerCase());
}
