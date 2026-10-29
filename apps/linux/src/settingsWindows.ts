import { openWindow, type OpenWindowOptions } from "../../browser/src/platform/windows";
import { goToSettingsPane, type SettingsPane, type SettingsPlace } from "../../browser/src/state/settings/settingsWindows";
import { ardiaHost, reportHostError } from "./host";
import { flushLinuxSession } from "./session";

export * from "../../browser/src/state/settings/settingsWindows";

export function openSettings(pane?: SettingsPane, profileId?: string | null) {
  let settings: SettingsPlace | undefined;
  if (pane) {
    goToSettingsPane(pane, profileId ?? null);
    settings = { pane, profileId: profileId ?? null, detail: null };
  }
  const options: OpenWindowOptions & { settings?: SettingsPlace } = { kind: "settings", title: "Settings", ...(settings ? { settings } : {}) };
  void flushLinuxSession().then(() => openWindow("settings", options)).catch(reportHostError);
}

let preferredImportSource = ardiaHost?.bootstrap.utility?.importSource ?? null;
export const setPreferredImportSource = (source: string) => void (preferredImportSource = source);

export function takePreferredImportSource() {
  const source = preferredImportSource;
  preferredImportSource = null;
  return source;
}

export function openImport(browserId?: string) {
  const options: OpenWindowOptions & { importSource?: string } = { kind: "import", title: "Import from Another Browser", ...(browserId ? { importSource: browserId } : {}) };
  void flushLinuxSession().then(() => openWindow("import", options)).catch(reportHostError);
}
