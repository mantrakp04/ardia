import { resolveInput } from "@ardia/core";
import { useState } from "react";
import { currentBookmarkRoots, currentBookmarks, currentSettings } from "../../state/browser/current";
import { addBookmark, addBookmarkFolder, moveBookmark, updateBookmark } from "../../state/bookmarks/actions";
import { useWindowId } from "../../state/browser/hooks";
import { searchUrlPrefix } from "../../state/settings/settings";
import { Box, Button, Dialog, Text, TextField } from "../ui";
import { closeBookmarkEditor, useBookmarkEditor, type EditorState } from "../../state/bookmarks/edit";
import { FieldLabel, FolderPicker } from "./DialogParts";
import { editBookmarkDialog, folderPicker } from "./tokens";

export function EditBookmarkDialog() {
  const windowId = useWindowId();
  const open = useBookmarkEditor((e) => (e.open?.windowId === windowId ? e.open : null));
  if (!open) return null;
  return <Sheet key={`${open.bookmarkId}:${open.folder}`} state={open} />;
}

function Sheet({ state }: { state: EditorState }) {
  const node = currentBookmarks().nodes[state.bookmarkId ?? ""];
  const [title, setTitle] = useState(node?.title ?? "");
  const [url, setUrl] = useState(node?.kind === "url" ? node.url : "");
  const [parentId, setParentId] = useState<string | null>(
    node?.parentId ?? state.parentId ?? currentBookmarkRoots(state.profileId)?.bar ?? null,
  );
  const close = closeBookmarkEditor;
  const resolvedUrl = url.trim() ? resolveInput(url, searchUrlPrefix(currentSettings())) : "";
  const valid = state.folder ? !!title.trim() : !!resolvedUrl;

  const save = () => {
    if (!valid) return;
    if (node) {
      updateBookmark(node.id, state.folder ? { title: title.trim() } : { title: title.trim(), url: resolvedUrl });
      if (parentId && parentId !== node.parentId) moveBookmark(node.id, parentId);
    } else if (state.folder) {
      addBookmarkFolder({ profileId: state.profileId, title: title.trim(), parentId: parentId ?? undefined, index: state.index });
    } else {
      addBookmark({ profileId: state.profileId, url: resolvedUrl, title: title.trim() || resolvedUrl, parentId: parentId ?? undefined, index: state.index });
    }
    close();
  };

  const heading = state.folder ? (node ? "Rename Folder" : "New Folder") : node ? "Edit Bookmark" : "Add Bookmark";

  return (
    <Dialog width={editBookmarkDialog.width} pad="xlx" onDismiss={close}>
      <Text size="heading" weight="semibold">
        {heading}
      </Text>
      <FieldLabel text="Name" />
      <TextField value={title} onChangeText={setTitle} autoFocus selectOnFocus onSubmit={save} onEscape={close} />
      {!state.folder && (
        <>
          <FieldLabel text="URL" />
          <TextField value={url} onChangeText={setUrl} placeholder="https://" onSubmit={save} onEscape={close} />
        </>
      )}
      {(!state.folder || !node) && (
        <>
          <FieldLabel text="Folder" />
          <FolderPicker profileId={state.profileId} selectedId={parentId} onSelect={setParentId} height={folderPicker.editHeight} />
        </>
      )}
      <Box row gap="m" style={BUTTONS}>
        <Button title="Cancel" onPress={close} />
        <Button title="Save" kind="primary" disabled={!valid} onPress={save} />
      </Box>
    </Dialog>
  );
}

const BUTTONS = { justifyContent: "flex-end", marginTop: editBookmarkDialog.buttonsTop } as const;
