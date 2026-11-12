import type { Settings } from "../../../state/settings/settings";

export type SettingsEnv = { top: boolean; glass?: boolean };
export type SettingRow = { title: string; description?: string; keywords?: string[]; advanced?: true; shown?: (settings: Settings, env: SettingsEnv) => boolean };
export type SettingSection = { section: string; rows: Record<string, SettingRow> };

export const APP = "Ardia";
