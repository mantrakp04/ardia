import { prepare, type Searchable } from "./searchMatch";
import { SETTINGS_PANES, type SettingsPane } from "../../state/settings/settingsWindows";
import type { Settings } from "../../state/settings/settings";
import { generalRows } from "./rows/generalRows";
import { privacyRows } from "./rows/privacyRows";
import { toolRows } from "./rows/toolRows";
import type { SettingSection, SettingsEnv } from "./rows/types";

const PANE_LOOKS: Record<SettingsPane, { title: string; icon: string }> = {
  general: { title: "General", icon: "gearshape" },
  profiles: { title: "Profiles", icon: "person.2" },
  sync: { title: "Sync", icon: "arrow.triangle.2.circlepath" },
  tabs: { title: "Tabs", icon: "square.on.square" },
  appearance: { title: "Appearance", icon: "circle.lefthalf.filled" },
  privacy: { title: "Privacy & Security", icon: "hand.raised" },
  passwords: { title: "Passwords", icon: "key" },
  autofill: { title: "Autofill", icon: "creditcard" },
  extensions: { title: "Extensions", icon: "puzzlepiece.extension" },
  search: { title: "Search Engine", icon: "magnifyingglass" },
  engines: { title: "Engines", icon: "safari" },
  shortcuts: { title: "Keyboard Shortcuts", icon: "keyboard" },
  liveFolders: { title: "Live Folders", icon: "dot.radiowaves.left.and.right" },
  calendar: { title: "Calendar", icon: "calendar" },
  advanced: { title: "Advanced", icon: "slider.horizontal.3" },
};

export const PANES: { id: SettingsPane; title: string; icon: string }[] = SETTINGS_PANES.map((id) => ({ id, ...PANE_LOOKS[id] }));

const ROWS = { ...generalRows, ...privacyRows, ...toolRows };

type RowKeysOf<P extends SettingsPane> = (typeof ROWS)[P][number] extends infer S ? (S extends { rows: infer R } ? keyof R & string : never) : never;
export type SettingId = { [P in SettingsPane]: `${P}.${RowKeysOf<P>}` }[SettingsPane];

export type SettingEntry = Searchable & { id: SettingId; pane: SettingsPane; section: string; advanced: boolean; shown?: (settings: Settings, env: SettingsEnv) => boolean };

const paneTitle = (pane: SettingsPane) => PANE_LOOKS[pane].title;

export const SETTINGS: SettingEntry[] = PANES.flatMap(({ id: pane }) =>
  (ROWS[pane] as SettingSection[]).flatMap(({ section, rows }) =>
    Object.entries(rows).map(([key, row]) => ({ ...row, id: `${pane}.${key}` as SettingId, pane, paneTitle: paneTitle(pane), section, advanced: !!row.advanced })),
  ),
);

const byId = new Map(SETTINGS.map((s) => [s.id, s]));

export const findSetting = (id: string): SettingEntry | undefined => byId.get(id as SettingId);

export function setting(id: SettingId): SettingEntry {
  const entry = byId.get(id);
  if (!entry) throw new Error(`no setting ${id}`);
  return entry;
}

export const SETTINGS_INDEX = prepare(SETTINGS);

export const unshownSettings = (settings: Settings, env: SettingsEnv) =>
  SETTINGS.filter((e) => e.shown && !e.shown(settings, env))
    .map((e) => e.id)
    .join("\n");

export const sectionEntries = (pane: SettingsPane, section: string) => SETTINGS.filter((s) => s.pane === pane && s.section === section);

export const ADVANCED_PANES = new Set(PANES.map((p) => p.id).filter((pane) => SETTINGS.some((s) => s.pane === pane) && SETTINGS.every((s) => s.pane !== pane || s.advanced)));
