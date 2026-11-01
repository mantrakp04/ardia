import { profileIdForSpace } from "../profiles/current";
import { focusWindow, openWindow } from "../../platform/windows";
import { create } from "zustand";
import { useBrowser } from "../browser/store";

export const SETTINGS_WINDOW_ID = "settings";
export const IMPORT_WINDOW_ID = "import";

export const isUtilityWindowId = (id: string | null | undefined) =>
  id === SETTINGS_WINDOW_ID || id === IMPORT_WINDOW_ID;

export const SETTINGS_PANES = [
  "general",
  "profiles",
  "spaces",
  "sync",
  "tabs",
  "appearance",
  "privacy",
  "passwords",
  "autofill",
  "extensions",
  "search",
  "engines",
  "shortcuts",
  "liveFolders",
  "calendar",
  "advanced",
] as const;

export type SettingsPane = (typeof SETTINGS_PANES)[number];

export type SettingsPlace = { pane: SettingsPane; spaceId: string | null; detail: string | null };

type Nav = SettingsPlace & { back: SettingsPlace[]; forward: SettingsPlace[] };

const placeOf = ({ pane, spaceId, detail }: SettingsPlace): SettingsPlace => ({ pane, spaceId, detail });

export const useSettingsNav = create<Nav>()(() => ({ pane: "general", spaceId: null, detail: null, back: [], forward: [] }));

export function goToSettingsPane(pane: SettingsPane, spaceId: string | null = null, detail: string | null = null) {
  const current = useSettingsNav.getState();
  if (current.pane === pane && current.spaceId === spaceId && current.detail === detail) return;
  useSettingsNav.setState({ pane, spaceId, detail, back: [...current.back, placeOf(current)].slice(-30), forward: [] });
}

export function replaceSettingsPlace(spaceId: string | null, detail: string | null = null) {
  const { pane, back } = useSettingsNav.getState();
  const prev = back.at(-1);
  const same = prev?.pane === pane && prev.spaceId === spaceId && prev.detail === detail;
  useSettingsNav.setState({ spaceId, detail, back: same ? back.slice(0, -1) : back, forward: [] });
}

export function settingsBack() {
  const current = useSettingsNav.getState();
  const prev = current.back.at(-1);
  if (prev) useSettingsNav.setState({ ...prev, back: current.back.slice(0, -1), forward: [placeOf(current), ...current.forward] });
}

export function settingsForward() {
  const current = useSettingsNav.getState();
  const next = current.forward[0];
  if (next) useSettingsNav.setState({ ...next, forward: current.forward.slice(1), back: [...current.back, placeOf(current)] });
}

export function openSettings(pane?: SettingsPane, spaceId?: string | null) {
  if (pane) {
    const dataPane = ["general", "profiles", "privacy", "passwords", "autofill", "extensions"].includes(pane);
    const target = dataPane && spaceId ? profileIdForSpace(spaceId) : spaceId;
    goToSettingsPane(pane, target ?? null);
  }
  void openWindow(SETTINGS_WINDOW_ID, { kind: "settings", title: "Settings" });
}

export function openProfileSettings(pane: "profiles" | "passwords" | "autofill" | "extensions", profileId: string) {
  goToSettingsPane(pane, profileId);
  void openWindow(SETTINGS_WINDOW_ID, { kind: "settings", title: "Settings" });
}

export const useImportRequest = create<{ source: string | null }>()(() => ({ source: null }));

export function takePreferredImportSource() {
  const { source } = useImportRequest.getState();
  useImportRequest.setState({ source: null });
  return source;
}

export function openImport(browserId?: string) {
  useImportRequest.setState({ source: browserId ?? null });
  void openWindow(IMPORT_WINDOW_ID, { kind: "import", title: "Import from Another Browser" });
}

export function settingsBrowserWindow(): string | null {
  const s = useBrowser.getState();
  return s.ui.focusOrder.find((id) => s.windows[id] && s.windows[id]!.kind !== "private") ?? s.windowOrder.find((id) => s.windows[id]!.kind !== "private") ?? null;
}

export function openUrlFromSettings(url: string) {
  const windowId = settingsBrowserWindow();
  if (!windowId) return;
  useBrowser.getState().newTab(windowId, { url });
  void focusWindow(windowId);
}
