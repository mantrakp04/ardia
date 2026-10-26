import { create } from "zustand";
import { useBrowser } from "../browser/store";
import { resolveWindowId } from "../browser/model";

export type EditorState = {
  windowId: string;
  bookmarkId: string | null;
  folder: boolean;
  profileId: string;
  parentId?: string;
  index?: number;
};

export const useBookmarkEditor = create<{ open: EditorState | null }>()(() => ({ open: null }));

export const closeBookmarkEditor = () => useBookmarkEditor.setState({ open: null });

export function editBookmark(
  id: string | null,
  windowId: string | null | undefined,
  add: { profileId: string; parentId?: string; index?: number; folder?: boolean } = { profileId: "" },
) {
  const s = useBrowser.getState();
  const w = resolveWindowId(s, windowId);
  if (!w) return;
  const node = id ? s.bookmarks.nodes[id] : undefined;
  if (id && !node) return;
  const profileId =
    add.profileId ||
    Object.entries(s.bookmarks.roots).find(([, r]) => {
      let n = node;
      for (let i = 0; n?.parentId && i < 64; i++) n = s.bookmarks.nodes[n.parentId];
      return n && (r.bar === n.id || r.other === n.id);
    })?.[0] ||
    s.settings.defaultProfileId;
  useBookmarkEditor.setState({
    open: {
      windowId: w,
      bookmarkId: id,
      folder: node ? node.kind === "folder" : !!add.folder,
      profileId,
      parentId: add.parentId,
      index: add.index,
    },
  });
}
