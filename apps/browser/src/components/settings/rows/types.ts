export type SettingRow = { title: string; description?: string; keywords?: string[]; liquidGlassOnly?: true };
export type SettingSection = { section: string; rows: Record<string, SettingRow> };

export const APP = "Ardia";
