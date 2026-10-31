import { setMenuBarShortcuts as setSharedMenuBarShortcuts } from "../../browser/src/state/commands/commandShortcuts";
import type { MenuShortcut } from "../../browser/src/platform/commands";
import { batchStoreUpdates, useBrowser } from "../../browser/src/state/browser/store";
import { shortcutItems } from "../../browser/src/state/settings/paneData";
import { store } from "../../browser/src/state/settings/resources";
import { linuxMenuShortcuts } from "./shortcuts";
import { migrateProfileShortcuts } from "./shortcutOverrides";

export * from "../../browser/src/state/commands/commandShortcuts";

let listed = false;

const migrate = () => {
  const state = useBrowser.getState();
  const shortcuts = migrateProfileShortcuts(state.settings.shortcuts, state.profileOrder);
  if (shortcuts === state.settings.shortcuts) return false;
  state.updateSettings({ shortcuts });
  return true;
};

const refresh = () => {
  const state = useBrowser.getState();
  const items = linuxMenuShortcuts(state.settings.shortcuts, state.profileOrder);
  batchStoreUpdates(() => {
    setSharedMenuBarShortcuts(items);
    store(shortcutItems, [], items);
  });
};

export function setMenuBarShortcuts(_items: readonly MenuShortcut[]) {
  listed = true;
  if (!migrate()) refresh();
}

useBrowser.subscribe((state, previous) => {
  if (state.profileOrder === previous.profileOrder && state.settings.shortcuts === previous.settings.shortcuts) return;
  if (!migrate() && listed) refresh();
});
