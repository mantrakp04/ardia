import { useBrowser } from "../../browser/src/state/browser/store";
import { linuxMenuShortcuts } from "./shortcuts";

export * from "../../browser/src/platform/commands";

export const menuShortcuts = async () => {
  const state = useBrowser.getState();
  return linuxMenuShortcuts(state.settings.shortcuts, state.profileOrder);
};
