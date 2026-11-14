import { orWarn } from "../../lib/fallback";
import { getDownloadSettings } from "../../platform/downloads";
import { openFile } from "../../platform/files";
import { showMenu, type MenuItem } from "../../platform/menus";
import { menuSections } from "../app/menuSections";
import { engineProfile, privateSession } from "../browser/model";
import { useBrowser } from "../browser/store";
import { menuShortcut } from "../commands/commandShortcuts";
import { openInternalPage } from "../pages/urls";
import { noteDownloadsButtonMenu } from "../telemetry/track";
import { clearDownloads, setDownloadsOpen } from "../windows/actions";
import { downloadsIn } from "./downloadsSlice";

export type DownloadsButtonMenuState = { panelOpen: boolean; clearable: boolean; shortcut?: ReturnType<typeof menuShortcut> };

export function downloadsButtonMenuItems(d: DownloadsButtonMenuState): MenuItem[] {
  return menuSections(
    [
      { id: "panel", title: d.panelOpen ? "Hide Downloads" : "Show Downloads", symbol: "list.bullet.rectangle", ...d.shortcut },
      { id: "page", title: "Show All Downloads", symbol: "arrow.down.circle" },
      { id: "folder", title: "Open Downloads Folder", symbol: "folder" },
    ],
    [{ id: "clear", title: "Clear Downloads", symbol: "minus.circle", enabled: d.clearable }],
  );
}

export async function openDownloadsButtonMenu(windowId: string) {
  const s = useBrowser.getState();
  const window = s.windows[windowId];
  if (!window) return;
  const panelOpen = !!s.windowUi[windowId]?.downloadsOpen;
  const choice = await showMenu(
    downloadsButtonMenuItems({ panelOpen, clearable: downloadsIn(s, windowId).some((d) => d.state !== "downloading"), shortcut: menuShortcut("downloads", s) }),
  );
  noteDownloadsButtonMenu(choice === "clear");
  if (choice === "panel") setDownloadsOpen(windowId, !panelOpen);
  if (choice === "page") openInternalPage("downloads", windowId);
  if (choice === "folder") void openDownloadsFolder(downloadSettingsProfile(s, window.profileId));
  if (choice === "clear") {
    setDownloadsOpen(windowId, false);
    clearDownloads(windowId);
  }
}

export const downloadSettingsProfile = (s: Parameters<typeof engineProfile>[0], profileId: string) => privateSession(s, profileId) ?? engineProfile(s, profileId);

async function openDownloadsFolder(profile: string) {
  const settings = await getDownloadSettings(profile).catch(orWarn(null));
  if (settings?.folder) await openFile(settings.folder);
}
