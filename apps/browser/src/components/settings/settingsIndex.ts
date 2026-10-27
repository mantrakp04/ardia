import { prepare, type Searchable } from "./searchMatch";
import type { SettingsPane } from "../../state/settings/settingsWindows";
import { generalRows } from "./rows/generalRows";
import { privacyRows } from "./rows/privacyRows";
import { toolRows } from "./rows/toolRows";
import type { SettingSection } from "./rows/types";
import { ADVANCED_SETTINGS } from "./rows/advanced";

export const PANES: { id: SettingsPane; title: string; icon: string }[] = [
  { id: "general", title: "General", icon: "gearshape" },
  { id: "profiles", title: "Profiles", icon: "person.2" },
  { id: "sync", title: "Sync", icon: "arrow.triangle.2.circlepath" },
  { id: "tabs", title: "Tabs", icon: "square.on.square" },
  { id: "appearance", title: "Appearance", icon: "circle.lefthalf.filled" },
  { id: "privacy", title: "Privacy & Security", icon: "hand.raised" },
  { id: "passwords", title: "Passwords", icon: "key" },
  { id: "autofill", title: "Autofill", icon: "creditcard" },
  { id: "extensions", title: "Extensions", icon: "puzzlepiece.extension" },
  { id: "search", title: "Search Engine", icon: "magnifyingglass" },
  { id: "engines", title: "Engines", icon: "safari" },
  { id: "shortcuts", title: "Keyboard Shortcuts", icon: "keyboard" },
  { id: "liveFolders", title: "Live Folders", icon: "dot.radiowaves.left.and.right" },
  { id: "calendar", title: "Calendar", icon: "calendar" },
  { id: "advanced", title: "Advanced", icon: "slider.horizontal.3" },
];

const ROWS: Record<SettingsPane, SettingSection[]> = { ...generalRows, ...privacyRows, ...toolRows };

export type SettingEntry = Searchable & { pane: SettingsPane; section: string; advanced: boolean; liquidGlassOnly?: true };

const paneTitle = (pane: SettingsPane) => PANES.find((p) => p.id === pane)!.title;

export const SETTINGS: SettingEntry[] = PANES.flatMap(({ id: pane }) =>
  ROWS[pane].flatMap(({ section, rows }) =>
    Object.entries(rows).map(([key, row]) => ({ id: `${pane}.${key}`, pane, paneTitle: paneTitle(pane), section, advanced: ADVANCED_SETTINGS.has(`${pane}.${key}`), ...row })),
  ),
);

const byId = new Map(SETTINGS.map((s) => [s.id, s]));

export const findSetting = (id: string): SettingEntry | undefined => byId.get(id);

export function setting(id: string): SettingEntry {
  const entry = byId.get(id);
  if (!entry) throw new Error(`no setting ${id}`);
  return entry;
}

export const SETTINGS_INDEX = prepare(SETTINGS);

export const sectionEntries = (pane: SettingsPane, section: string) => SETTINGS.filter((s) => s.pane === pane && s.section === section);

export const ADVANCED_PANES = new Set(PANES.map((p) => p.id).filter((pane) => SETTINGS.some((s) => s.pane === pane) && SETTINGS.every((s) => s.pane !== pane || s.advanced)));
