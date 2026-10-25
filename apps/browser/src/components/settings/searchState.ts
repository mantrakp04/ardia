import type { View } from "react-native";
import { create } from "zustand";
import { setting } from "./settingsIndex";
import { useSettingsNav } from "./windows";
import { settingsProfileFor } from "../extensions/store";

type SearchUi = {
  query: string;
  selected: number;
  focusRequest: number;
  reveal: { id: string; at: number } | null;
  flash: { id: string; at: number } | null;
};

export const useSettingsSearch = create<SearchUi>(() => ({ query: "", selected: 0, focusRequest: 0, reveal: null, flash: null }));

export const setSettingsQuery = (query: string) => useSettingsSearch.setState({ query });

export const focusSettingsSearch = () => useSettingsSearch.setState({ focusRequest: Date.now() });

export function revealSetting(id: string) {
  const nav = useSettingsNav.getState();
  const pane = setting(id).pane;
  nav.go(pane, settingsProfileFor(pane, nav));
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
