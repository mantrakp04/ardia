import { resolveInput } from "@ardia/core";
import { useState } from "react";
import { currentBookmarkRoots, currentBookmarks, currentSettings } from "../../state/browser/current";
import { addBookmark, addBookmarkFolder, moveBookmark, updateBookmark } from "../../state/bookmarks/actions";
import { useWindowId } from "../../state/browser/hooks";
import { searchUrlPrefix } from "../../state/settings/settings";
import { Button, Dialog, DialogActions, DialogTitle, TextField } from "../ui";
import { FormField } from "../settings/Form";
import { closeBookmarkEditor, useBookmarkEditor, type EditorState } from "../../state/bookmarks/edit";
import { FolderPicker } from "./DialogParts";

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
    <Dialog width="s" pad="xl" onDismiss={close}>
      <DialogTitle>{heading}</DialogTitle>
      <FormField label="Name">
        <TextField value={title} onChangeText={setTitle} autoFocus selectOnFocus onSubmit={save} onEscape={close} />
      </FormField>
      {!state.folder && (
        <FormField label="URL">
          <TextField value={url} onChangeText={setUrl} placeholder="https://" onSubmit={save} onEscape={close} />
        </FormField>
      )}
      {(!state.folder || !node) && (
        <FormField label="Folder">
          <FolderPicker profileId={state.profileId} selectedId={parentId} onSelect={setParentId} />
        </FormField>
      )}
      <DialogActions>
        <Button title="Cancel" onPress={close} />
        <Button title="Save" kind="primary" disabled={!valid} onPress={save} />
      </DialogActions>
    </Dialog>
  );
}
