import type { BrowserState } from "../browser/store";
import { insertAll, nestGroups, orderSections, syncGroupOrder } from "./groups";
import { markPinned } from "../pins/pinChoices";
import { IDLE_LIVE, isIncognitoProfile, makeTab, newId } from "../browser/model";
import { pageKey, pinnedPages } from "../tabs/pageKeys";
import type { BookmarkFolder, Bookmarks, TabGroup } from "../browser/types";
import { isWebPageUrl } from "../../lib/url";
import { pinnedGroupMembers } from "../browser/structure";
import { ASLEEP } from "../tabs/pageSession";

export type GroupDraft = { title: string; url?: string; customTitle?: string; id?: string; children?: GroupDraft[] };
export type DraftGroups = { made: string[]; carried: Set<string>; skipped: number };

export const MAX_DRAFT_LINKS = 5000;

export const opens = (url: string | undefined): url is string => !!url && isWebPageUrl(url);
export const hasLinks = (d: GroupDraft): boolean => !!d.children?.some((c) => (c.url ? opens(c.url) : hasLinks(c)));

export function bookmarkDraft(b: Bookmarks, folderId: string): GroupDraft | null {
  const node = b.nodes[folderId];
  if (node?.kind !== "folder") return null;
  const walk = (folder: BookmarkFolder): GroupDraft[] =>
    folder.children.flatMap((c): GroupDraft[] => {
      const n = b.nodes[c];
      if (!n) return [];
      return n.kind === "url" ? [{ id: n.id, title: n.title, url: n.url }] : [{ id: n.id, title: n.title, children: walk(n) }];
    });
  return { id: node.id, title: node.title, children: walk(node) };
}

export function withDraftGroups(s: BrowserState, windowId: string, profileId: string, drafts: GroupDraft[]): [BrowserState, DraftGroups] {
  const carried = new Set<string>();
  const w = s.windows[windowId];
  if (!w || w.kind === "private") return [s, { made: [], carried, skipped: 0 }];
  const seen = pinnedPages(s, profileId);
  const tabs = { ...s.tabs };
  const live = { ...s.live };
  let groups = { ...s.groups };
  const order: string[] = [];
  const made: string[] = [];
  const all: string[] = [];
  const now = Date.now();
  let skipped = 0;
  let taken = 0;
  const make = (d: GroupDraft, parentId?: string): string[] => {
    const id = newId("g");
    const tabIds: string[] = [];
    for (const c of d.children ?? []) {
      if (!c.url) {
        for (const t of make(c, id)) tabIds.push(t);
        continue;
      }
      if (!opens(c.url) || seen.has(pageKey(c.url))) continue;
      if (taken >= MAX_DRAFT_LINKS) {
        skipped++;
        continue;
      }
      seen.add(pageKey(c.url));
      taken++;
      const t = { ...makeTab(windowId, profileId, c.url, { title: c.title, customTitle: c.customTitle ?? null }), page: ASLEEP };
      tabs[t.id] = t;
      live[t.id] = IDLE_LIVE;
      order.push(t.id);
      tabIds.push(t.id);
      if (c.id) carried.add(c.id);
    }
    if (!tabIds.length) return tabIds;
    groups[id] = { id, windowId, profileId, name: d.title, icon: null, color: null, collapsed: false, pinned: true, tabIds, createdAt: now, ...(parentId ? { parentId } : {}) };
    all.push(id);
    if (!parentId) made.push(id);
    return tabIds;
  };
  for (const d of drafts) {
    taken = 0;
    make(d);
  }
  if (!made.length) return [s, { made, carried, skipped }];
  const pinnedArea = pinnedGroupMembers(s.groups);
  const at = w.tabIds.reduce((last, id, i) => (s.tabs[id]?.pin || pinnedArea.has(id) ? i + 1 : last), 0);
  const ids = [...w.tabIds];
  insertAll(ids, at, order);
  groups = nestGroups(groups);
  const window = { ...w, tabIds: orderSections(ids, tabs, groups) };
  let pinChoices = s.pinChoices;
  if (!isIncognitoProfile(profileId)) {
    pinChoices = markPinned(pinChoices, profileId, { groups: all, placed: order });
  }
  return [{ ...s, tabs, live, pinChoices, groups: syncGroupOrder(groups, window), windows: { ...s.windows, [windowId]: window } }, { made, carried, skipped }];
}
