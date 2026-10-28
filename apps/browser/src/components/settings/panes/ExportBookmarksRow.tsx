import { useState } from "react";
import { exportBookmarks } from "../../../state/bookmarks/exportHtml";
import { profileOfWindow } from "../../../state/bookmarks/bookmarkGroups";
import { useProfiles } from "../../../state/browser/hooks";
import { settingsBrowserWindow } from "../../../state/settings/settingsWindows";
import { Button, PopUp } from "../../ui";
import { Row } from "../Form";

export function ExportBookmarksRow() {
  const profiles = useProfiles();
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
      {profiles.length > 1 ? (
        <PopUp value={profileId} options={profiles.map((p) => ({ value: p.id, title: p.name }))} onChange={setProfileId} />
      ) : null}
      <Button title="Export…" disabled={busy} onPress={() => void run()} />
    </Row>
  );
}
