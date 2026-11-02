import { prompt } from "../../state/app/system";
import { useEffect, useState } from "react";
import { useWindowId } from "../../state/browser/hooks";
import { Button, Dialog, DialogActions, layout, Text, TextField } from "../ui";
import { FormField } from "../settings/Form";
import { addBookmarkFolder, addBookmarkTree, closeBookmarkDialog, moveBookmark, profileOfBookmark, removeBookmark, updateBookmark, useBookmarkDialog, type BookmarkDialogState } from "../../state/bookmarks/actions";
import { useBookmarks } from "../../state/bookmarks/hooks";
import { currentBookmarkRoots, currentBookmarks } from "../../state/browser/current";
import { FolderPicker } from "./DialogParts";
import { bookmarkDialog } from "./tokens";
import { useAddressBarInSidebar } from "../../state/windows/layout";
import { useToolbarRow } from "../toolbar/useToolbarRow";
import { SIDEBAR_HEADER_WITH_FIELD } from "../sidebar/geometry";

export function BookmarkDialog() {
  const windowId = useWindowId();
  const open = useBookmarkDialog((d) => (d.open?.windowId === windowId ? d.open : null));
  if (!open) return null;
  return <DialogPanel key={open.kind === "page" ? open.bookmarkId : "all"} state={open} />;
}

function DialogPanel({ state }: { state: BookmarkDialogState }) {
  const addressBar = useAddressBarInSidebar();
  const toolbarHeight = useToolbarRow().height;
  const bookmark = useBookmarks((b) => (state.kind === "page" ? b.nodes[state.bookmarkId] : undefined));
  const profileId = state.kind === "page" ? profileOfBookmark(state.bookmarkId) : state.profileId;
  const [name, setName] = useState(() => (state.kind === "page" ? (bookmark?.title ?? "") : ""));
  const [folderId, setFolderId] = useState<string | null>(() =>
    state.kind === "page" ? (bookmark?.parentId ?? null) : (currentBookmarkRoots(state.profileId)?.bar ?? null),
  );
  const close = closeBookmarkDialog;

  useEffect(() => {
    if (state.kind === "page" && !bookmark) close();
  }, [bookmark]);

  const done = () => {
    if (state.kind === "page") {
      if (!currentBookmarks().nodes[state.bookmarkId]) return close();
      if (name.trim() && name !== bookmark?.title) updateBookmark(state.bookmarkId, { title: name.trim() });
      if (folderId && folderId !== bookmark?.parentId) moveBookmark(state.bookmarkId, folderId);
    } else {
      const title = name.trim() || "Tabs";
      addBookmarkTree(state.profileId, [{ title, children: state.tabs.map((t) => ({ title: t.title, url: t.url })) }], folderId ?? undefined);
    }
    close();
  };

  const remove = () => {
    if (state.kind === "page") removeBookmark(state.bookmarkId);
    close();
  };

  const newFolder = async () => {
    const title = await prompt({ title: "New Folder", placeholder: "Folder name", confirmTitle: "Create", windowId: state.windowId });
    if (!title || !profileId) return;
    const id = addBookmarkFolder({ profileId, title, parentId: folderId ?? undefined });
    setFolderId(id);
  };

  const heading = state.kind === "allTabs" ? `Bookmark ${state.tabs.length} Tabs` : "Bookmark Added";

  return (
    <Dialog
      width="xs"
      pad="xl"
      onDismiss={done}
      place={
        addressBar
          ? { top: SIDEBAR_HEADER_WITH_FIELD + bookmarkDialog.belowField, left: layout.sidebarInset }
          : { top: layout.cardInset + toolbarHeight - bookmarkDialog.belowToolbar, right: layout.cardInset + bookmarkDialog.rightInset }
      }
    >
      <Text weight="semibold">{heading}</Text>
      <FormField label={state.kind === "allTabs" ? "Folder name" : "Name"}>
        <TextField value={name} onChangeText={setName} autoFocus selectOnFocus placeholder={state.kind === "allTabs" ? "Tabs" : "Name"} onSubmit={done} onEscape={done} />
      </FormField>
      <FormField label="Folder">
        <FolderPicker profileId={profileId} selectedId={folderId} onSelect={setFolderId} />
      </FormField>
      <DialogActions leading={<Button title="New Folder" onPress={newFolder} />}>
        {state.kind === "page" ? <Button title="Remove" onPress={remove} /> : <Button title="Cancel" onPress={close} />}
        <Button title={state.kind === "page" ? "Done" : "Save"} kind="primary" onPress={done} />
      </DialogActions>
    </Dialog>
  );
}
