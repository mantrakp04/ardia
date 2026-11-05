import { call, on, type BookmarkOp, type EngineBookmark } from "@ardia/ardiacore";

export type { EngineBookmark, BookmarkOp };

export const bookmarkTree = (profile: string) => call("bookmarks.tree", { profile });
export const applyBookmarkOps = (profile: string, ops: BookmarkOp[]) => call("bookmarks.apply", { profile, ops });
export const watchBookmarks = (profile: string) => call("bookmarks.watch", { profile });
export const exportBookmarksHtml = (profile: string) => call("bookmarks.exportHtml", { profile });
export const onBookmarksChanged = (listener: (profile: string) => void) => on("bookmarks.changed", (p) => listener(p.profile));
