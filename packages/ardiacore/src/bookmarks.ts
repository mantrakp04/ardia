import { call, on } from "./engine/call";

export type EngineBookmark = { id: string; k: "u" | "f"; t: string; u?: string; a: number; key?: string; c?: EngineBookmark[] };

export type BookmarkOp =
  | { op: "add"; id: string; k: "u" | "f"; t: string; u?: string; a: number; key?: string; parent: string; index?: number; ifAbsent?: boolean }
  | { op: "move"; id: string; parent: string; index: number }
  | { op: "update"; id: string; t?: string; u?: string }
  | { op: "remove"; id: string };

export const bookmarkTree = (profile: string) => call("bookmarks.tree", { profile });

export const applyBookmarkOps = (profile: string, ops: BookmarkOp[]) =>
  call("bookmarks.apply", { profile, ops });

export const watchBookmarks = (profile: string) => call("bookmarks.watch", { profile });

export const onBookmarksChanged = (listener: (profile: string) => void) =>
  on("bookmarks.changed", (p) => listener(p.profile));
