import { create } from "zustand";
import { goToSettingsPane, useSettingsNav, type SettingsPane } from "./settingsWindows";
import { settingsProfileFor } from "../extensions/store";
import { noteSettingsSearchReveal } from "../telemetry/usage";

type SearchUi = {
  query: string;
  selected: number;
  keyboardMove: number;
  focusRequest: number;
  reveal: { id: string; at: number } | null;
  flash: { id: string; at: number } | null;
  revealedSections: string[];
};

export const useSettingsSearch = create<SearchUi>()(() => ({ query: "", selected: 0, keyboardMove: 0, focusRequest: 0, reveal: null, flash: null, revealedSections: [] }));

export const settingsSectionKey = (pane: SettingsPane, section: string) => `${pane}\u0000${section}`;

export const setSettingsQuery = (query: string) => useSettingsSearch.setState({ query, selected: 0, keyboardMove: 0 });

export const focusSettingsSearch = () => useSettingsSearch.setState({ focusRequest: Date.now() });

export const currentSettingsSearch = () => useSettingsSearch.getState();

export const moveSettingsSelection = (step: number, count: number) =>
  useSettingsSearch.setState((s) => ({ selected: Math.max(0, Math.min(count - 1, s.selected + step)), keyboardMove: s.keyboardMove + 1 }));

export const clearSettingsReveal = () => useSettingsSearch.setState({ reveal: null });

export function revealSetting({ id, pane, section }: { id: string; pane: SettingsPane; section: string }, via: "keyboard" | "click") {
  noteSettingsSearchReveal(via);
  const key = settingsSectionKey(pane, section);
  useSettingsSearch.setState((s) => (s.revealedSections.includes(key) ? {} : { revealedSections: [...s.revealedSections, key] }));
  goToSettingsPane(pane, settingsProfileFor(pane, useSettingsNav.getState()));
  useSettingsSearch.setState({ reveal: { id, at: Date.now() } });
}

export const flashSetting = (id: string) => useSettingsSearch.setState({ reveal: null, flash: { id, at: Date.now() } });
