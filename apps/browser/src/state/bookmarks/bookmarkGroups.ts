import { useBrowser, type BrowserState } from "../browser/store";
import { bookmarkDraft, hasLinks, MAX_DRAFT_LINKS, withDraftGroups, type DraftGroups, type GroupDraft } from "../groups/draftGroups";
import { bookmarkSpaceId, plural } from "../browser/model";
import { isRegularWindow, mainWindowFor } from "../windows/small";
import { showToast } from "../app/toasts";
import { bookmarkRoots, type BookmarkOwners } from "./bookmarks";

export const ARC_HOLDER = " (Arc)";

function sidebarWindow(s: BrowserState, spaceId: string, near?: string | null): string | undefined {
  const w = near ? s.windows[near] : undefined;
  if (isRegularWindow(w)) return w.id;
  return mainWindowFor(s, spaceId);
}

export function addGroupsFromDrafts(spaceId: string, drafts: GroupDraft[], near?: string | null): DraftGroups {
  const s = useBrowser.getState();
  const windowId = sidebarWindow(s, spaceId, near) ?? s.createWindow({ spaceId });
  const [next, result] = withDraftGroups(useBrowser.getState(), windowId, spaceId, drafts);
  if (result.made.length) useBrowser.setState(next);
  if (result.skipped) showToast(windowId, `${plural(result.skipped, "link")} left out`, `A folder brings up to ${MAX_DRAFT_LINKS.toLocaleString("en-US")} links.`);
  return result;
}

export function spaceOfWindow(windowId: string | null | undefined): string {
  const s = useBrowser.getState();
  return bookmarkSpaceId(s, windowId ? s.windows[windowId] : undefined);
}

export function makesGroup(s: Pick<BrowserState, "bookmarks">, folderId: string): boolean {
  const draft = bookmarkDraft(s.bookmarks, folderId);
  return !!draft && hasLinks(draft);
}

export function addFolderToSidebar(folderId: string, windowId: string | null): string[] {
  const s = useBrowser.getState();
  const draft = bookmarkDraft(s.bookmarks, folderId);
  return draft ? addGroupsFromDrafts(spaceOfWindow(windowId), [draft], windowId).made : [];
}

function holderSpace(s: BookmarkOwners, folderId: string, prefer?: string): string | undefined {
  const node = s.bookmarks.nodes[folderId];
  if (node?.kind !== "folder" || !node.title.endsWith(ARC_HOLDER) || !node.parentId) return undefined;
  const owners = s.spaceOrder.filter((p) => bookmarkRoots(s, p)?.bar === node.parentId);
  return prefer && owners.includes(prefer) ? prefer : owners[0];
}

export function restorableArcHolder(s: BookmarkOwners, folderId: string): boolean {
  const node = s.bookmarks.nodes[folderId];
  return !!holderSpace(s, folderId) && node?.kind === "folder" && node.children.some((id) => makesGroup(s, id));
}

export const allArcHolders = (s: BookmarkOwners) => [...new Set(s.spaceOrder.flatMap((p) => arcHolders(s, p)))];

export function arcHolders(s: BookmarkOwners, spaceId: string): string[] {
  const bar = bookmarkRoots(s, spaceId)?.bar;
  const root = bar ? s.bookmarks.nodes[bar] : undefined;
  return root?.kind === "folder" ? root.children.filter((id) => restorableArcHolder(s, id)) : [];
}

function carriedOver(b: BrowserState["bookmarks"], id: string, carried: Set<string>): { whole: boolean; ids: string[] } {
  const node = b.nodes[id];
  if (!node) return { whole: false, ids: [] };
  if (node.kind === "url") return carried.has(id) ? { whole: true, ids: [id] } : { whole: false, ids: [] };
  const parts = node.children.map((c) => carriedOver(b, c, carried));
  return node.children.length && parts.every((p) => p.whole) ? { whole: true, ids: [id] } : { whole: false, ids: parts.flatMap((p) => p.ids) };
}

export function restoreArcFolders(holderId: string, windowId: string | null): string[] {
  const s = useBrowser.getState();
  const owner = holderSpace(s, holderId, windowId ? spaceOfWindow(windowId) : undefined);
  if (!owner) return [];
  const spaceId = s.spaces[owner] ? owner : spaceOfWindow(windowId);
  const holder = s.bookmarks.nodes[holderId];
  const folders = holder?.kind === "folder" ? holder.children.filter((id) => makesGroup(s, id)) : [];
  const near = windowId && s.windows[windowId]?.spaceId === spaceId ? windowId : null;
  const { made, carried } = addGroupsFromDrafts(spaceId, folders.map((id) => bookmarkDraft(s.bookmarks, id)!), near);
  const b = useBrowser.getState();
  b.removeBookmarks(folders.flatMap((id) => carriedOver(b.bookmarks, id, carried).ids));
  const left = useBrowser.getState().bookmarks.nodes[holderId];
  if (left?.kind === "folder" && !left.children.length) useBrowser.getState().removeBookmark(holderId);
  return made;
}
