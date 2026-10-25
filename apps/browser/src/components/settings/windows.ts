import { openWindow } from "@ardia/shell";
import { create } from "zustand";

export const SETTINGS_WINDOW_ID = "settings";
export const IMPORT_WINDOW_ID = "import";

export const isUtilityWindowId = (id: string | null | undefined) =>
  id === SETTINGS_WINDOW_ID || id === IMPORT_WINDOW_ID;

export type SettingsPane =
  | "general"
  | "profiles"
  | "sync"
  | "tabs"
  | "appearance"
  | "privacy"
  | "passwords"
  | "autofill"
  | "extensions"
  | "search"
  | "engines"
  | "shortcuts"
  | "liveFolders"
  | "calendar"
  | "advanced";

export type SettingsPlace = { pane: SettingsPane; profileId: string | null; detail: string | null };

type Nav = SettingsPlace & {
  back: SettingsPlace[];
  forward: SettingsPlace[];
  go(pane: SettingsPane, profileId?: string | null, detail?: string | null): void;
  replace(profileId: string | null, detail?: string | null): void;
  goBack(): void;
  goForward(): void;
};

const placeOf = ({ pane, profileId, detail }: SettingsPlace): SettingsPlace => ({ pane, profileId, detail });

export const useSettingsNav = create<Nav>((set, get) => ({
  pane: "general",
  profileId: null,
  detail: null,
  back: [],
  forward: [],
  go(pane, profileId = null, detail = null) {
    const current = get();
    if (current.pane === pane && current.profileId === profileId && current.detail === detail) return;
    set({ pane, profileId, detail, back: [...current.back, placeOf(current)].slice(-30), forward: [] });
  },
  replace(profileId, detail = null) {
    const { pane, back } = get();
    const prev = back.at(-1);
    const same = prev?.pane === pane && prev.profileId === profileId && prev.detail === detail;
    set({ profileId, detail, back: same ? back.slice(0, -1) : back, forward: [] });
  },
  goBack() {
    const current = get();
    const prev = current.back.at(-1);
    if (prev) set({ ...prev, back: current.back.slice(0, -1), forward: [placeOf(current), ...current.forward] });
  },
  goForward() {
    const current = get();
    const next = current.forward[0];
    if (next) set({ ...next, forward: current.forward.slice(1), back: [...current.back, placeOf(current)] });
  },
}));

export function openSettings(pane?: SettingsPane, profileId?: string | null) {
  if (pane) useSettingsNav.getState().go(pane, profileId ?? null);
  void openWindow(SETTINGS_WINDOW_ID, { kind: "settings", title: "Settings" });
}

let preferredImportSource: string | null = null;

export function takePreferredImportSource() {
  const id = preferredImportSource;
  preferredImportSource = null;
  return id;
}

export function openImport(browserId?: string) {
  preferredImportSource = browserId ?? null;
  void openWindow(IMPORT_WINDOW_ID, { kind: "import", title: "Import from Another Browser" });
}
