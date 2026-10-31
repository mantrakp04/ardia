import { closeWindow, isDarkAppearance, setAppearance } from "@ardia/shell";
import { onAppEvent } from "../../browser/src/platform/app";
import type { CommandEvent } from "../../browser/src/platform/commands";
import { onLinuxCommand } from "./shims/expo-modules-core";
import { Appearance } from "react-native";
import { reportHostError, type ArdiaHost } from "./host";
import { useBrowser } from "../../browser/src/state/browser/store";
import { goToSettingsPane, openImport, openSettings, type SettingsPlace } from "../../browser/src/state/settings/settingsWindows";
import { PANES } from "../../browser/src/components/settings/settingsIndex";
import { focusSettingsSearch } from "../../browser/src/state/settings/searchState";
import { startCalendar } from "../../browser/src/state/live/calendar";
import { menuShown } from "./menus";
import { startUtilityNavigation } from "./utilityNavigation";
import { setPreferredImportSource } from "./settingsWindows";

function setNavigation(value: unknown) {
  if (!value || typeof value !== "object") return;
  const place = value as SettingsPlace;
  const importSource = (value as { importSource?: unknown }).importSource;
  if (typeof importSource === "string") setPreferredImportSource(importSource);
  if (!PANES.some((pane) => pane.id === place.pane)) return;
  goToSettingsPane(place.pane, typeof place.profileId === "string" ? place.profileId : null, typeof place.detail === "string" ? place.detail : null);
}

export function startUtility(host: ArdiaHost) {
  const id = host.bootstrap.windowId;
  onLinuxCommand((event) => {
    const { command } = event as CommandEvent;
    if (command === "closeTab") void closeWindow(id).catch(reportHostError);
    else if (command === "findInPage" && id === "settings") focusSettingsSearch();
    else if (command === "openSettings") openSettings();
    else if (command === "keyboardShortcuts") openSettings("shortcuts");
    else if (command === "importBrowserData") openImport();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || menuShown()) return;
    event.preventDefault();
    void closeWindow(id).catch(reportHostError);
  });
  if (id === "settings") startCalendar();
  const store = useBrowser;
  store.getState().setAppDark(Appearance.getColorScheme() === "dark");
  void setAppearance(store.getState().settings.appearance);
  void isDarkAppearance().then((dark) => store.getState().setAppDark(dark));
  onAppEvent((event) => {
    if (event.type === "appearance") store.getState().setAppDark(event.dark);
  });
  store.subscribe((state, previous) => {
    if (state.settings.appearance !== previous.settings.appearance) void setAppearance(state.settings.appearance);
  });
  return startUtilityNavigation(host, setNavigation).ready;
}
