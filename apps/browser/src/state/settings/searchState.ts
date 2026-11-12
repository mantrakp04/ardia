import { create } from "zustand";
import { goToSettingsPane, useSettingsNav, type SettingsPane } from "./settingsWindows";
import { settingsProfileFor } from "../extensions/store";
import { noteSettingsSearch, noteSettingsSearchReveal } from "../telemetry/usage";

type SearchUi = {
  query: string;
  selected: number;
  keyboardMove: number;
  focusRequest: number;
  reveal: { id: string; at: number } | null;
  flash: { id: string; at: number } | null;
  revealedSections: string[];
  previewSection: string | null;
  previewing: boolean;
};

type Target = { id: string; pane: SettingsPane; section: string };

export const useSettingsSearch = create<SearchUi>()(() => ({
  query: "",
  selected: 0,
  keyboardMove: 0,
  focusRequest: 0,
  reveal: null,
  flash: null,
  revealedSections: [],
  previewSection: null,
  previewing: false,
}));

export const settingsSectionKey = (pane: SettingsPane, section: string) => `${pane}\u0000${section}`;

export const sectionRevealed = (s: Pick<SearchUi, "revealedSections" | "previewSection">, key: string) => s.revealedSections.includes(key) || s.previewSection === key;

let emptyNoted = false;

export function setSettingsQuery(query: string) {
  const started = !useSettingsSearch.getState().query.trim() && !!query.trim();
  if (started) {
    emptyNoted = false;
    noteSettingsSearch("started");
  }
  useSettingsSearch.setState({ query, selected: 0, keyboardMove: 0, ...(query.trim() ? {} : { previewing: false }) });
}

export function noteSettingsSearchEmpty() {
  if (emptyNoted) return;
  emptyNoted = true;
  noteSettingsSearch("empty");
}

export const focusSettingsSearch = () => useSettingsSearch.setState({ focusRequest: Date.now() });

export const currentSettingsSearch = () => useSettingsSearch.getState();

export const moveSettingsSelection = (step: number, count: number) =>
  useSettingsSearch.setState((s) => ({ selected: Math.max(0, Math.min(count - 1, s.selected + step)), keyboardMove: s.keyboardMove + 1 }));

export const selectSettingsResult = (index: number) => useSettingsSearch.setState({ selected: index });

export const clearSettingsReveal = () => useSettingsSearch.setState({ reveal: null });

export function revealSetting({ id, pane, section }: Target, via: "keyboard" | "click", rank: number) {
  noteSettingsSearchReveal(via, rank);
  const key = settingsSectionKey(pane, section);
  useSettingsSearch.setState((s) => (s.revealedSections.includes(key) ? {} : { revealedSections: [...s.revealedSections, key] }));
  if (!useSettingsSearch.getState().previewing) goToSettingsPane(pane, settingsProfileFor(pane, useSettingsNav.getState()));
  else showWithoutHistory(pane);
  useSettingsSearch.setState({ reveal: { id, at: Date.now() }, previewing: false });
}

export function previewSetting({ id, pane, section }: Target) {
  const { previewing, reveal } = useSettingsSearch.getState();
  if (reveal?.id === id && previewing && useSettingsNav.getState().pane === pane) return;
  if (!previewing) goToSettingsPane(pane, settingsProfileFor(pane, useSettingsNav.getState()));
  else showWithoutHistory(pane);
  useSettingsSearch.setState({ previewSection: settingsSectionKey(pane, section), previewing: true, reveal: { id, at: Date.now() } });
}

function showWithoutHistory(pane: SettingsPane) {
  const nav = useSettingsNav.getState();
  const profileId = settingsProfileFor(pane, nav);
  if (nav.pane !== pane || nav.profileId !== profileId || nav.detail) useSettingsNav.setState({ pane, profileId, detail: null, forward: [] });
}

export const flashSetting = (id: string) => useSettingsSearch.setState({ reveal: null, flash: { id, at: Date.now() } });
