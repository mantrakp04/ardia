import { useState } from "react";
import { exportBookmarks } from "../../../state/bookmarks/exportHtml";
import { profileOfWindow } from "../../../state/bookmarks/bookmarkGroups";
import { settingsBrowserWindow } from "../../../state/settings/settingsWindows";
import { Button } from "../../ui";
import { ProfilePicker, Row } from "../Form";

export function ExportBookmarksRow() {
  const [profileId, setProfileId] = useState(() => profileOfWindow(settingsBrowserWindow()));
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setStatus("");
    try {
      const path = await exportBookmarks(profileId);
      if (path) setStatus(`Saved “${path.split("/").pop()}” to “${path.split("/").slice(-2, -1)[0] ?? ""}”.`);
    } catch (error) {
      setStatus(`Couldn't export: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Row anchor="general.exportBookmarks" description={status || undefined}>
      <ProfilePicker value={profileId} onChange={setProfileId} />
      <Button title="Export…" disabled={busy} onPress={() => void run()} />
    </Row>
  );
}
