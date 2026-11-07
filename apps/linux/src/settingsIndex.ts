import * as shared from "../../browser/src/components/settings/settingsIndex.ts";
import { linuxCapabilities, unavailablePanes, unavailableSettingIds } from "./hostCapabilities.ts";

export * from "../../browser/src/components/settings/settingsIndex.ts";

const capabilities = linuxCapabilities();
const hiddenPanes = unavailablePanes(capabilities);
const hiddenSettings = unavailableSettingIds(capabilities, shared.SETTINGS.map((entry) => entry.id));

export const settingUnavailable = (id: string | undefined) => !!id && hiddenSettings.has(id);
export const sectionUnavailable = (pane: string | null | undefined, section: string | undefined) => {
  if (!pane || !section) return false;
  const entries = shared.sectionEntries(pane as Parameters<typeof shared.sectionEntries>[0], section);
  return entries.length > 0 && entries.every((entry) => hiddenSettings.has(entry.id));
};
export const PANES: typeof shared.PANES = shared.PANES.filter((pane) => !hiddenPanes.has(pane.id));
export const SETTINGS_INDEX: typeof shared.SETTINGS_INDEX = shared.SETTINGS_INDEX.filter((item) => !settingUnavailable(item.entry.id) && !hiddenPanes.has(item.entry.pane));
