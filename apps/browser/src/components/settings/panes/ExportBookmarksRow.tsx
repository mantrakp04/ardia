import { useState } from "react";
import { exportBookmarks } from "../../../state/bookmarks/exportHtml";
import { profileOfWindow } from "../../../state/bookmarks/bookmarkGroups";
import { settingsBrowserWindow } from "../../../state/settings/settingsWindows";
import { Button } from "../../ui";
import { ProfilePicker, Row, useHiddenSetting } from "../Form";
import { findSetting } from "../settingsIndex";

export function ExportBookmarksRow() {
  const [profileId, setProfileId] = useState(() => profileOfWindow(settingsBrowserWindow()));
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const hidden = useHiddenSetting();
  if (hidden(findSetting("general.exportBookmarks"))) return null;
  const run = async () => {
    setBusy(true);
    setStatus("");
    try {
      const path = await exportBookmarks(profileId);
      if (path) {
        const parts = path.split(/[\\/]/);
        setStatus(`Saved “${parts.at(-1) ?? path}” to “${parts.at(-2) ?? ""}”.`);
      }
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
