import { create } from "zustand";
import { remoteSuggestions, suggest, type TrayRow } from "./omnibox";

export type SearchOrigin = "start" | "page";

type SearchState = { open: boolean; origin: SearchOrigin; initialText: string; text: string; rows: TrayRow[]; session: number };

export const useSearch = create<SearchState>()(() => ({ open: true, origin: "start", initialText: "", text: "", rows: [], session: 0 }));

let remote: { text: string; values: string[] } = { text: "", values: [] };
let inFlight: AbortController | null = null;

export function presentSearch(origin: SearchOrigin, text = "") {
  inFlight?.abort();
  remote = { text: "", values: [] };
  useSearch.setState((state) => ({ open: true, origin, initialText: text, text, rows: suggest(text, []).rows, session: state.session + 1 }));
}

export function dismissSearch() {
  inFlight?.abort();
  useSearch.setState({ open: false });
}

export function typeSearch(text: string) {
  const carried = remote.text && text.startsWith(remote.text) ? remote.values : [];
  useSearch.setState({ text, rows: suggest(text, carried).rows });
  inFlight?.abort();
  if (!text.trim()) return;
  const controller = new AbortController();
  inFlight = controller;
  void remoteSuggestions(text, controller.signal).then((values) => {
    if (controller.signal.aborted || useSearch.getState().text !== text) return;
    remote = { text, values };
    useSearch.setState({ rows: suggest(text, values).rows });
  });
}

export function handleSearchBack(): boolean {
  if (!useSearch.getState().open) return false;
  dismissSearch();
  return true;
}
