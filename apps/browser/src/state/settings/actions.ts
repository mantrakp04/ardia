import type { Shortcut } from "../commands/shortcuts";
import { storeAction, useBrowser } from "../browser/store";

export const updateSettings = storeAction("updateSettings");
export const setSearchEngine = storeAction("setSearchEngine");
export const addCustomEngine = storeAction("addCustomEngine");
export const updateCustomEngine = storeAction("updateCustomEngine");
export const removeCustomEngine = storeAction("removeCustomEngine");

export function setShortcutOverride(id: string, combo: Shortcut | null) {
  const next = { ...useBrowser.getState().settings.shortcuts };
  if (combo) next[id] = [combo.key, ...combo.modifiers];
  else delete next[id];
  useBrowser.getState().updateSettings({ shortcuts: next });
}

export function chooseTabLayout(layout: "sidebar" | "top") {
  const s = useBrowser.getState();
  s.updateSettings({ tabLayout: layout });
  for (const w of Object.values(s.windows)) {
    if ((w.tabLayout ?? s.settings.tabLayout) !== layout) useBrowser.getState().toggleTabLayout(w.id);
  }
  useBrowser.getState().updateSettings({ tabLayout: layout });
}
