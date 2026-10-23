import type { BrowserState } from "./browser";
import { nestGroups, orderSections, syncGroupOrder } from "./groups";
import { groupChoiceKey, nextPinChoice, placeChoiceKey } from "./organize";
import { IDLE_LIVE, isIncognitoProfile, makeTab, newId } from "./model";
import type { BookmarkFolder, Bookmarks, TabGroup } from "./types";

export type GroupDraft = { title: string; url?: string; customTitle?: string; children?: GroupDraft[] };

export const opens = (url: string | undefined): url is string => !!url && /^(https?|file):/i.test(url);
export const hasLinks = (d: GroupDraft): boolean => !!d.children?.some((c) => (c.url ? opens(c.url) : hasLinks(c)));
const draftUrls = (d: GroupDraft): string[] => (d.url ? (opens(d.url) ? [d.url] : []) : (d.children ?? []).flatMap(draftUrls));
const signature = (name: string, urls: string[]) => `${name}\u0001${[...urls].sort().join("\u0001")}`;

export function bookmarkDraft(b: Bookmarks, folderId: string): GroupDraft | null {
  const node = b.nodes[folderId];
  if (node?.kind !== "folder") return null;
  const walk = (folder: BookmarkFolder): GroupDraft[] =>
    folder.children.flatMap((c): GroupDraft[] => {
      const n = b.nodes[c];
      if (!n) return [];
      return n.kind === "url" ? [{ title: n.title, url: n.url }] : [{ title: n.title, children: walk(n) }];
    });
  return { title: node.title, children: walk(node) };
}

export function withDraftGroups(s: BrowserState, windowId: string, profileId: string, drafts: GroupDraft[]): [BrowserState, string[]] {
  const w = s.windows[windowId];
  if (!w || w.incognito) return [s, []];
  const have = new Set(
    Object.values(s.groups)
      .filter((g) => g.pinned && !g.parentId && g.windowId === windowId && g.profileId === profileId)
      .map((g) => signature(g.name, g.tabIds.map((id) => s.tabs[id]?.url ?? ""))),
  );
  const tabs = { ...s.tabs };
  const live = { ...s.live };
  let groups = { ...s.groups };
  const order: string[] = [];
  const made: string[] = [];
  const all: string[] = [];
  const now = Date.now();
  const make = (d: GroupDraft, parentId?: string): string[] => {
    const id = newId("g");
    const tabIds: string[] = [];
    for (const c of d.children ?? []) {
      if (c.url) {
        if (!opens(c.url)) continue;
        const t = { ...makeTab(windowId, profileId, c.url, { title: c.title, customTitle: c.customTitle ?? null }), navigation: null, unloaded: true as const };
        tabs[t.id] = t;
        live[t.id] = IDLE_LIVE;
        order.push(t.id);
        tabIds.push(t.id);
      } else if (hasLinks(c)) tabIds.push(...make(c, id));
    }
    const group: TabGroup = { id, windowId, profileId, name: d.title, icon: null, color: null, collapsed: false, pinned: true, tabIds, createdAt: now, ...(parentId ? { parentId } : {}) };
    groups[id] = group;
    all.push(id);
    if (!parentId) made.push(id);
    return tabIds;
  };
  for (const d of drafts) {
    if (!hasLinks(d) || have.has(signature(d.title, draftUrls(d)))) continue;
    have.add(signature(d.title, draftUrls(d)));
    make(d);
  }
  if (!made.length) return [s, []];
  const pinnedArea = new Set(Object.values(s.groups).filter((g) => g.pinned).flatMap((g) => g.tabIds));
  const at = w.tabIds.reduce((last, id, i) => (s.tabs[id]?.pinned || pinnedArea.has(id) ? i + 1 : last), 0);
  const ids = [...w.tabIds];
  ids.splice(at, 0, ...order);
  groups = nestGroups(groups);
  const window = { ...w, tabIds: orderSections(ids, tabs, groups) };
  let pinChoices = s.pinChoices;
  if (!isIncognitoProfile(profileId)) {
    const mine = { ...pinChoices[profileId] };
    for (const id of all) mine[groupChoiceKey(id)] = nextPinChoice();
    for (const id of order) mine[placeChoiceKey(id)] = nextPinChoice();
    pinChoices = { ...pinChoices, [profileId]: mine };
  }
  return [{ ...s, tabs, live, pinChoices, groups: syncGroupOrder(groups, window), windows: { ...s.windows, [windowId]: window } }, made];
}
