import { useState } from "react";
import { exportBookmarks } from "../../../state/bookmarks/exportHtml";
import { spaceOfWindow } from "../../../state/bookmarks/bookmarkGroups";
import { settingsBrowserWindow } from "../../../state/settings/settingsWindows";
import { Button } from "../../ui";
import { ProfilePicker, Row } from "../Form";

export function ExportBookmarksRow() {
  const [spaceId, setSpaceId] = useState(() => spaceOfWindow(settingsBrowserWindow()));
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setStatus("");
    try {
      const path = await exportBookmarks(spaceId);
      if (path) setStatus(`Saved “${path.split("/").pop()}” to “${path.split("/").slice(-2, -1)[0] ?? ""}”.`);
    } catch (error) {
      setStatus(`Couldn't export: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Row anchor="general.exportBookmarks" description={status || undefined}>
      <ProfilePicker value={spaceId} onChange={setSpaceId} />
      <Button title="Export…" disabled={busy} onPress={() => void run()} />
    </Row>
  );
}
