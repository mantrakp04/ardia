import { focusWindow } from "../../platform/windows";
import { settingsBrowserWindow } from "../settings/settingsWindows";
import { redoOnboarding } from "./onboarding";

export function redoSetupFromSettings() {
  const windowId = redoOnboarding(settingsBrowserWindow());
  if (windowId) void focusWindow(windowId);
}
