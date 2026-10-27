import type { View } from "react-native";
import { create } from "zustand";
import { goToSettingsPane, useSettingsNav, type SettingsPane } from "./settingsWindows";
import { settingsProfileFor } from "../extensions/store";

type SearchUi = {
  query: string;
  selected: number;
  focusRequest: number;
  reveal: { id: string; at: number } | null;
  flash: { id: string; at: number } | null;
  revealedSections: string[];
};

export const useSettingsSearch = create<SearchUi>()(() => ({ query: "", selected: 0, focusRequest: 0, reveal: null, flash: null, revealedSections: [] }));

export const settingsSectionKey = (pane: SettingsPane, section: string) => `${pane}\u0000${section}`;

export const setSettingsQuery = (query: string) => useSettingsSearch.setState({ query });

export const focusSettingsSearch = () => useSettingsSearch.setState({ focusRequest: Date.now() });

export const currentSettingsSearch = () => useSettingsSearch.getState();

export const selectSettingsResult = (index: number) => useSettingsSearch.setState({ selected: index });

export const moveSettingsSelection = (step: number, count: number) =>
  useSettingsSearch.setState((s) => ({ selected: Math.max(0, Math.min(count - 1, s.selected + step)) }));

export const clearSettingsReveal = () => useSettingsSearch.setState({ reveal: null });

export function revealSetting({ id, pane, section }: { id: string; pane: SettingsPane; section: string }) {
  const key = settingsSectionKey(pane, section);
  useSettingsSearch.setState((s) => (s.revealedSections.includes(key) ? {} : { revealedSections: [...s.revealedSections, key] }));
  goToSettingsPane(pane, settingsProfileFor(pane, useSettingsNav.getState()));
  useSettingsSearch.setState({ reveal: { id, at: Date.now() } });
}

export const flashSetting = (id: string) => useSettingsSearch.setState({ reveal: null, flash: { id, at: Date.now() } });

const anchors = new Map<string, View>();

export const anchorView = (id: string) => anchors.get(id);

export function registerAnchor(id: string, view: View) {
  anchors.set(id, view);
  return () => {
    if (anchors.get(id) === view) anchors.delete(id);
  };
}
