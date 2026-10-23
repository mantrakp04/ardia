import { useBrowser, type BrowserState } from "../store/browser";
import { bookmarkDraft, hasLinks, opens, withDraftGroups, type GroupDraft } from "../store/draftGroups";
import { bookmarkProfileId } from "../store/model";
import { mainWindowFor } from "../store/small";

export const ARC_HOLDER = " (Arc)";

function sidebarWindow(s: BrowserState, profileId: string, near?: string | null): string | undefined {
  const w = near ? s.windows[near] : undefined;
  if (w && !w.incognito && w.kind !== "small") return w.id;
  return mainWindowFor(s, profileId);
}

export function addGroupsFromDrafts(profileId: string, drafts: GroupDraft[], near?: string | null): string[] {
  const s = useBrowser.getState();
  const windowId = sidebarWindow(s, profileId, near) ?? s.createWindow({ profileId });
  const [next, made] = withDraftGroups(useBrowser.getState(), windowId, profileId, drafts);
  if (made.length) useBrowser.setState(next);
  return made;
}

export function profileOfWindow(windowId: string | null | undefined): string {
  const s = useBrowser.getState();
  return bookmarkProfileId(s, windowId ? s.windows[windowId] : undefined);
}

export function makesGroup(s: Pick<BrowserState, "bookmarks">, folderId: string): boolean {
  const draft = bookmarkDraft(s.bookmarks, folderId);
  return !!draft && hasLinks(draft);
}

export function addFolderToSidebar(folderId: string, windowId: string | null): string[] {
  const s = useBrowser.getState();
  const draft = bookmarkDraft(s.bookmarks, folderId);
  return draft ? addGroupsFromDrafts(profileOfWindow(windowId), [draft], windowId) : [];
}

function holderProfile(s: Pick<BrowserState, "bookmarks">, folderId: string): string | undefined {
  const node = s.bookmarks.nodes[folderId];
  if (node?.kind !== "folder" || !node.title.endsWith(ARC_HOLDER) || !node.parentId) return undefined;
  return Object.entries(s.bookmarks.roots).find(([, r]) => r.bar === node.parentId)?.[0];
}

export function restorableArcHolder(s: Pick<BrowserState, "bookmarks">, folderId: string): boolean {
  const node = s.bookmarks.nodes[folderId];
  return !!holderProfile(s, folderId) && node?.kind === "folder" && node.children.some((id) => makesGroup(s, id));
}

export const allArcHolders = (s: Pick<BrowserState, "bookmarks">) => Object.keys(s.bookmarks.roots).flatMap((p) => arcHolders(s, p));

export function arcHolders(s: Pick<BrowserState, "bookmarks">, profileId: string): string[] {
  const bar = s.bookmarks.roots[profileId]?.bar;
  const root = bar ? s.bookmarks.nodes[bar] : undefined;
  return root?.kind === "folder" ? root.children.filter((id) => restorableArcHolder(s, id)) : [];
}

function converted(b: BrowserState["bookmarks"], id: string): { whole: boolean; ids: string[] } {
  const node = b.nodes[id];
  if (!node) return { whole: false, ids: [] };
  if (node.kind === "url") return opens(node.url) ? { whole: true, ids: [id] } : { whole: false, ids: [] };
  const parts = node.children.map((c) => converted(b, c));
  return node.children.length && parts.every((p) => p.whole) ? { whole: true, ids: [id] } : { whole: false, ids: parts.flatMap((p) => p.ids) };
}

export function restoreArcFolders(holderId: string, windowId: string | null): string[] {
  const s = useBrowser.getState();
  const owner = holderProfile(s, holderId);
  if (!owner) return [];
  const profileId = s.profiles[owner] ? owner : profileOfWindow(windowId);
  const holder = s.bookmarks.nodes[holderId];
  const folders = holder?.kind === "folder" ? holder.children.filter((id) => makesGroup(s, id)) : [];
  const near = windowId && s.windows[windowId]?.profileId === profileId ? windowId : null;
  const made = addGroupsFromDrafts(profileId, folders.map((id) => bookmarkDraft(s.bookmarks, id)!), near);
  const b = useBrowser.getState();
  b.removeBookmarks(folders.flatMap((id) => converted(b.bookmarks, id).ids));
  const left = useBrowser.getState().bookmarks.nodes[holderId];
  if (left?.kind === "folder" && !left.children.length) useBrowser.getState().removeBookmark(holderId);
  return made;
}
