import type { BrowserState } from "../browser/store";
import { pinSection } from "../browser/model";
import { pinnedGroupMembers } from "../browser/structure";

export function pageKey(url: string): string {
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)(.*)$/i.exec(url.trim());
  if (!m) return url;
  const at = m[2]!.lastIndexOf("@");
  const host = `${m[2]!.slice(0, at + 1)}${m[2]!.slice(at + 1).toLowerCase()}`;
  const rest = m[3]!.startsWith("/") ? m[3]! : `/${m[3]}`;
  return `${m[1]!.toLowerCase()}${host}${rest.replace(/#$/, "")}`;
}

const pageKeys = (tabs: { url: string; pinnedUrl?: string | null }[]): Set<string> =>
  new Set(tabs.flatMap((t) => [t.url, t.pinnedUrl].filter((u): u is string => !!u).map(pageKey)));

export function pinnedPages(s: Pick<BrowserState, "tabs" | "groups" | "parkedPins">, spaceId: string): Set<string> {
  const inPinnedGroup = pinnedGroupMembers(s.groups);
  const pinned = Object.values(s.tabs).filter((t) => t.spaceId === spaceId && (t.pin || inPinnedGroup.has(t.id)));
  return pageKeys([...pinned, ...(s.parkedPins[spaceId]?.tabs ?? [])]);
}

export function tilePages(s: Pick<BrowserState, "tabs" | "groups" | "parkedPins">, spaceId: string): Set<string> {
  const inGroup = new Set(Object.values(s.groups).flatMap((g) => g.tabIds));
  const tiles = Object.values(s.tabs).filter((t) => t.spaceId === spaceId && pinSection(t) === "tile" && !inGroup.has(t.id));
  const parkedTiles = (s.parkedPins[spaceId]?.tabs ?? []).filter((t) => pinSection(t) === "tile" && !t.groupId);
  return pageKeys([...tiles, ...parkedTiles]);
}

export function openPages(s: Pick<BrowserState, "tabs" | "parkedPins">, spaceId: string): Set<string> {
  const open = Object.values(s.tabs).filter((t) => t.spaceId === spaceId);
  return pageKeys([...open, ...(s.parkedPins[spaceId]?.tabs ?? [])]);
}
