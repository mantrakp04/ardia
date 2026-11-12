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
import { paneChunks } from "../splits/splits";
import { noteImportedPins } from "../telemetry/usage";
import { bookmarkRoots, type BookmarkDraft } from "../bookmarks/bookmarks";
import type { GroupDraft } from "../groups/draftGroups";
import { useBrowser } from "../browser/store";
import { engineProfile, isIncognitoProfile, ROW_PIN } from "../browser/model";
import { openPages, pageKey, pinnedPages, tilePages } from "../tabs/pageKeys";
import { withNewTab } from "../tabs/tabs";
import type { ProfileColor } from "../browser/types";
import { setProfileTheme } from "../profiles/themeActions";
import { parseArcTheme } from "./arcTheme";
import { newProfileLiveFolder } from "../live/engine";
import { live } from "../live/store";
import type { LiveSourceId } from "../live/types";
import { isWebPageUrl, withoutFragment } from "../../lib/url";
import { focusedWindowOf } from "../windows/ui";
import { originOfLogin } from "../site/savedPasswords";
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
    : { title: n.title, ...(n.role === SPLIT_ROLE ? { split: true } : {}), children: (n.children ?? []).map(toGroupDraft) };

const SPLIT_ROLE = "split";
const isSplitNode = (n: ImportedNode) => n.type === "folder" && n.role === SPLIT_ROLE;

const LIVE_SOURCES: Partial<Record<NonNullable<ImportedNode["role"]>, LiveSourceId>> = {
  liveGitHubPullRequests: "github",
  liveBitbucketPullRequests: "bitbucket",
};
const liveSourceOf = (n: ImportedNode) => (n.role ? LIVE_SOURCES[n.role] : undefined);
const liveSources = (nodes: ImportedNode[]): LiveSourceId[] =>
  nodes.flatMap((n) => [...(liveSourceOf(n) ? [liveSourceOf(n)!] : []), ...liveSources(n.children ?? [])]);
const withoutLiveFolders = (nodes: ImportedNode[]): ImportedNode[] =>
  nodes.filter((n) => !liveSourceOf(n)).map((n) => (n.children ? { ...n, children: withoutLiveFolders(n.children) } : n));

function importPullRequestsFolders(profileId: string, nodes: ImportedNode[]) {
  for (const source of new Set(liveSources(nodes))) {
    const have = Object.values(live().folders).some((f) => f.profileId === profileId && f.kind === "pullRequests" && f.sources.includes(source));
    if (!have) newProfileLiveFolder(profileId, "pullRequests", [source]);
  }
}

const linksOf = (nodes: ImportedNode[]): string[] => nodes.flatMap((n) => (n.type === "url" ? (n.url ? [n.url] : []) : linksOf(n.children ?? [])));

function importFavicons(profileId: string, favicons: ImportedFavicon[] | undefined, urls: string[]) {
  if (!favicons?.length || !urls.length) return;
  const wanted = new Set(urls.map(withoutFragment));
  adoptFavicons(profileId, favicons.filter((f) => wanted.has(withoutFragment(f.page))));
}

const linkCount = (nodes: ImportedNode[]): number => nodes.reduce((n, c) => n + (c.type === "url" ? 1 : linkCount(c.children ?? [])), 0);

export function importBookmarks(profileId: string, root: ImportedNode | undefined, browserName: string): number {
  if (!root?.children?.length) return 0;
  if (!bookmarkRoots(useBrowser.getState(), profileId)) useBrowser.getState().addBookmarkTree(profileId, []);
  const roots = bookmarkRoots(useBrowser.getState(), profileId)!;
  const toolbar = root.children.filter((c) => c.role === "toolbar").flatMap((c) => c.children ?? []);
  const rest = root.children.filter((c) => c.role !== "toolbar");
  const other = rest.flatMap((c) => (c.role === "other" || !c.role ? (c.type === "folder" ? (c.children ?? []) : [c]) : [c]));
  const title = `Imported from ${browserName}`;
  const place = (nodes: ImportedNode[], parentId: string) => {
    if (!nodes.length) return;
    const parent = useBrowser.getState().bookmarks.nodes[parentId];
    const empty = parent?.kind === "folder" && parent.children.length === 0;
    const drafts = nodes.map(toDraft);
    useBrowser.getState().addBookmarkTree(profileId, empty ? drafts : [{ title, children: drafts }], parentId);
  };
  place(toolbar, roots.bar);
  place(other, roots.other);
  return linkCount([...toolbar, ...other]);
}

export function importHistory(profileId: string, entries: { url: string; title: string; visits: number; lastVisit: number }[]): number {
  return useBrowser.getState().importHistory(profileId, entries);
}

async function importPasswords(profileId: string, credentials: Credential[]): Promise<number> {
  let saved = 0;
  for (const c of credentials) {
    const origin = originOfLogin(c.realm?.startsWith("http") ? c.realm : c.url);
    if (!origin || !c.password) continue;
    if (await savePassword(engineProfile(useBrowser.getState(), profileId), origin, c.username, c.password).catch(orWarn(false))) saved++;
  }
  return saved;
}

export async function importNative(
  profileId: string,
  token: string | undefined,
  kinds: ("cookies" | "autofill")[],
  onFailed?: (kind: ImportKind) => void,
): Promise<Pick<ImportCounts, "cookies" | "addresses" | "cards">> {
  const none = { cookies: 0, addresses: 0, cards: 0 };
  if (!token) return none;
  const api = importModule();
  if (!kinds.length || isIncognitoProfile(profileId) || useBrowser.getState().profiles[profileId] === undefined) {
    api.discardImported(token);
    return none;
  }
  try {
    const w = await api.writeImported(token, engineProfile(useBrowser.getState(), profileId), kinds);
    if (w.cookiesFailed) onFailed?.("cookies");
    if (w.autofillFailed) onFailed?.("autofill");
    return { cookies: w.cookies, addresses: w.addresses, cards: w.cards };
  } catch {
    kinds.forEach((k) => onFailed?.(k));
    return none;
  }
}

function windowFor(profileId: string): string {
  const s = useBrowser.getState();
  const regular = s.ui.focusOrder.find((id) => s.windows[id] && s.windows[id]!.kind !== "private") ?? s.windowOrder.find((id) => s.windows[id]!.kind !== "private");
  return regular ?? s.createWindow({ profileId });
}

export function openInWebStore(profileId: string, urls: string[]) {
  if (!urls.length) return;
  const windowId = windowFor(profileId);
  urls.forEach((url, i) => useBrowser.getState().newTab(windowId, { url, profileId, background: i > 0 }));
}

type IncomingTab = Pick<ImportedTab, "url" | "title" | "pinned" | "customTitle" | "splitId"> & { row?: boolean };

function freshTabs<T extends IncomingTab>(tabs: T[], pinned: Set<string>, open: Set<string>): T[] {
  const out: T[] = [];
  const keep = (t: T) => {
    const seen = t.pinned ? pinned : open;
    const key = pageKey(t.url);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  for (let i = 0; i < tabs.length; ) {
    const splitId = tabs[i]!.splitId;
    let end = i + 1;
    while (splitId && end < tabs.length && tabs[end]!.splitId === splitId) end++;
    const unit = tabs.slice(i, end).filter((t) => isWebPageUrl(t.url));
    i = end;
    if (unit.length < 2) {
      unit.forEach((t) => keep({ ...t, splitId: undefined }));
      continue;
    }
    const seen = unit[0]!.pinned ? pinned : open;
    if (unit.every((t) => seen.has(pageKey(t.url)))) continue;
    unit.forEach((t) => seen.add(pageKey(t.url)));
    out.push(...unit);
  }
  return out;
}

export function importTabs(profileId: string, tabs: IncomingTab[], group: string | null, pinnedAgainst: "anyPin" | "tiles" = "anyPin"): number {
  return importTabsWithSplits(profileId, tabs, group, pinnedAgainst).tabs;
}

function importTabsWithSplits(
  profileId: string,
  tabs: IncomingTab[],
  group: string | null,
  pinnedAgainst: "anyPin" | "tiles" = "anyPin",
): { tabs: number; splits: number } {
  const s = useBrowser.getState();
  const pinned = pinnedAgainst === "tiles" ? tilePages(s, profileId) : pinnedPages(s, profileId);
  const open = openPages(s, profileId);
  const usable = freshTabs(tabs, pinned, open);
  if (!usable.length) return { tabs: 0, splits: 0 };
  const windowId = windowFor(profileId);
  let next = useBrowser.getState();
  const unpinned: string[] = [];
  const panes = new Map<string, string[]>();
  for (const t of usable) {
    const after = t.pinned ? undefined : unpinned.at(-1);
    const [made, id] = withNewTab(next, windowId, {
      url: t.url,
      profileId,
      background: true,
      pinned: t.pinned,
      snapshot: { title: t.title, customTitle: t.customTitle ?? null, ...(t.pinned && t.row ? { pin: ROW_PIN } : {}) },
      index: after ? next.windows[windowId]!.tabIds.indexOf(after) + 1 : undefined,
    });
    if (!id) continue;
    next = { ...made, tabs: { ...made.tabs, [id]: { ...made.tabs[id]!, page: IDLE } } };
    if (!t.pinned) unpinned.push(id);
    if (t.splitId) panes.set(t.splitId, [...(panes.get(t.splitId) ?? []), id]);
  }
  useBrowser.setState(next);
  if (group && unpinned.length) useBrowser.getState().createGroup(unpinned, { name: group });
  let splits = 0;
  for (const ids of panes.values()) for (const chunk of paneChunks(ids)) if (useBrowser.getState().createSplit(chunk)) splits++;
  return { tabs: usable.length, splits };
}

const rowTab = (n: ImportedNode): IncomingTab => ({ url: n.url!, title: n.pageTitle ?? n.title, pinned: true, row: true, customTitle: n.pageTitle ? n.title : undefined });

export function importArcSpace(profileId: string, space: SpaceSuggestion, favicons?: ImportedFavicon[]): { tabs: number; bookmarks: number; skipped: number } {
  importFavicons(profileId, favicons, [...linksOf(space.pinned), ...space.tabs.map((t) => t.url)]);
  const rows = space.pinned.flatMap((n, i): IncomingTab[] => {
    if (n.type === "url") return n.url ? [rowTab(n)] : [];
    if (!isSplitNode(n)) return [];
    return (n.children ?? []).filter((c) => c.type === "url" && c.url).map((c) => ({ ...rowTab(c), splitId: `pinned-${i}` }));
  });
  importPullRequestsFolders(profileId, space.pinned);
  const folders = withoutLiveFolders(space.pinned.filter((n) => n.type === "folder" && !isSplitNode(n)));
  const pinnedRows = importTabsWithSplits(profileId, rows, null);
  const today = importTabsWithSplits(profileId, space.tabs.map((t) => ({ ...t, pinned: false })), "Imported");
  let tabs = pinnedRows.tabs + today.tabs;
  let splits = pinnedRows.splits + today.splits;
  const theme = space.theme ? parseArcTheme(space.theme) : null;
  if (theme) setProfileTheme(profileId, theme);
  let skipped = 0;
  if (folders.length) {
    const drafts = addGroupsFromDrafts(profileId, folders.map(toGroupDraft), windowFor(profileId));
    const groups = useBrowser.getState().groups;
    tabs += drafts.made.reduce((n, id) => n + (groups[id]?.tabIds.length ?? 0), 0);
    splits += drafts.splits;
    skipped = drafts.skipped;
  }
  noteImportedPins({ rows: pinnedRows.tabs, splits });
  return { tabs, bookmarks: 0, skipped };
}

export function importFavorites(profileId: string, tabs: ImportedTab[], favicons?: ImportedFavicon[]): number {
  if (!tabs.length) return 0;
  importFavicons(profileId, favicons, tabs.map((t) => t.url));
  return importTabs(profileId, tabs.map((t) => ({ ...t, pinned: true })), null, "tiles");
}

export function importDiaProfile(profileId: string, profile: DiaTabsProfile, what: { pinned: boolean; open: boolean }, favicons?: ImportedFavicon[]): number {
  importFavicons(profileId, favicons, [...(what.pinned ? profile.pinned : []), ...(what.open ? profile.tabs : [])].map((t) => t.url));
  const have = openPages(useBrowser.getState(), profileId);
  const fresh = (tabs: ImportedTab[]) => tabs.filter((t) => !have.has(pageKey(t.url)));
  let n = what.pinned ? importTabs(profileId, fresh(profile.pinned), null) : 0;
  if (what.open) n += importTabs(profileId, fresh(profile.tabs).map((t) => ({ ...t, pinned: false })), "Imported");
  return n;
}

export async function applyResult(
  profileId: string,
  result: ImportResult,
  browserName: string,
  requested: ImportKind[],
  onFailed?: (kind: ImportKind) => void,
): Promise<ImportCounts> {
  const toolbar = (result.bookmarks?.children ?? []).filter((c) => c.role === "toolbar");
  importFavicons(profileId, result.favicons, [...result.favorites.map((t) => t.url), ...(result.spaces.length ? [] : result.tabs.map((t) => t.url)), ...linksOf(toolbar)]);
  const counts = emptyCounts();
  counts.bookmarks += importBookmarks(profileId, result.bookmarks, browserName);
  if (result.history.length) counts.history += importHistory(profileId, result.history);
  const native = (["cookies", "autofill"] as const).filter((k) => requested.includes(k));
  Object.assign(counts, await importNative(profileId, result.vaultToken, native, onFailed));
  if (result.tabs.length && !result.spaces.length) counts.tabs += importTabs(profileId, result.tabs, "Imported");
  if (result.favorites.length) counts.tabs += importTabs(profileId, result.favorites.map((t) => ({ ...t, pinned: true })), null, "tiles");
  if (result.credentials.length) counts.passwords += await importPasswords(profileId, result.credentials);
  return counts;
}

export async function applySafari(profileId: string, data: SafariExport, cookies = true, onFailed?: (kind: ImportKind) => void): Promise<ImportCounts> {
  const counts = emptyCounts();
  counts.bookmarks = importBookmarks(profileId, data.bookmarks, "Safari");
  const history = data.profiles.find((p) => !p.name)?.history ?? data.profiles[0]?.history ?? [];
  counts.history = importHistory(profileId, history);
  Object.assign(counts, await importNative(profileId, data.vaultToken, cookies ? ["cookies", "autofill"] : ["autofill"], onFailed));
  if (data.tabs.length) counts.tabs += importTabs(profileId, data.tabs, "Imported");
  counts.passwords = await importPasswords(profileId, data.credentials);
  return counts;
}

export function profileColorFor(hex: string | undefined): ProfileColor | undefined {
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
  return w && w.kind !== "private" ? w.profileId : s.settings.defaultProfileId;
}

export function profileNamed(name: string): string | undefined {
  const s = useBrowser.getState();
  return s.profileOrder.find((id) => s.profiles[id]!.name.trim().toLowerCase() === name.trim().toLowerCase());
}
