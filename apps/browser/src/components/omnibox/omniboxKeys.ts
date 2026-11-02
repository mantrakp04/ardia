import { siteSearchKey, type Suggestion } from "@ardia/core";
import type { BarDismissal } from "../../state/omnibox/barState";
import { dispositionFor, type Disposition } from "../../state/omnibox/openFromBar";
import type { offeredScope } from "../../state/omnibox/scopes";
import { isRemovable } from "./SuggestionRow";
import type { useBarText } from "./useBarText";

const BASE_KEYS = [
  { key: "Escape" },
  { key: "ArrowUp" },
  { key: "ArrowDown" },
  { key: "PageUp" },
  { key: "PageDown" },
  { key: "Tab" },
  { key: "Tab", shiftKey: true },
  { key: "n", ctrlKey: true },
  { key: "p", ctrlKey: true },
  { key: "Enter", metaKey: true },
  { key: "Enter", altKey: true },
  { key: "Enter", shiftKey: true },
  { key: "Enter", ctrlKey: true },
  { key: "Enter", ctrlKey: true, shiftKey: true },
];
const SCOPE_KEYS = [...BASE_KEYS, { key: "Backspace" }];
const REMOVE_KEYS = [...BASE_KEYS, { key: "Delete", shiftKey: true }];

export const PASTED_TYPES = ["string" as const];

export const barKeyDownEvents = (scopeAsksForBackspace: boolean, removable: boolean) => (scopeAsksForBackspace ? SCOPE_KEYS : removable ? REMOVE_KEYS : BASE_KEYS);

export type BarKeyEvent = { nativeEvent: { key: string; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean } };

export type BarKeyContext = {
  bar: ReturnType<typeof useBarText>;
  hero: boolean;
  shownCompletion: string;
  items: Suggestion[];
  selectedIndex: number;
  current: Suggestion | undefined;
  tabScope: ReturnType<typeof offeredScope>;
  cancelBang(): void;
  onDone?(reason?: BarDismissal): void;
  reset(): void;
  removeRow(url: string): void;
  forceSearch(): void;
  go(url: string, disposition?: Disposition): void;
  choose(s: Suggestion | undefined, disposition?: Disposition, byEnter?: boolean): void;
};

export function barKeyDown(e: BarKeyEvent, k: BarKeyContext) {
  const { key, metaKey, altKey, shiftKey, ctrlKey } = e.nativeEvent;
  const { bar, items, selectedIndex, current } = k;
  const { scope, typed } = bar;
  const select = (index: number) => bar.dispatch({ kind: "selected", index });
  const move = (delta: 1 | -1) => {
    const n = items.length;
    select(!n ? 0 : selectedIndex < 0 ? (delta > 0 ? 0 : n - 1) : (selectedIndex + delta + n) % n);
  };
  k.cancelBang();
  if (key === "Escape") {
    if (scope) return bar.dispatch({ kind: "leftScope", restore: null });
    if (!k.hero) return k.onDone?.("escape");
    if (k.shownCompletion) return bar.dispatch({ kind: "completionDropped" });
    return k.reset();
  }
  if (key === "ArrowDown" || (ctrlKey && key === "n")) return move(1);
  if (key === "ArrowUp" || (ctrlKey && key === "p")) return move(-1);
  if (key === "PageUp") return select(0);
  if (key === "PageDown") return select(Math.max(0, items.length - 1));
  if (key === "Delete" && shiftKey) return isRemovable(current) ? k.removeRow(current.url) : undefined;
  if ((key === "Tab" && !ctrlKey) || key === "Backspace") {
    const action = siteSearchKey(key, { shiftKey, altKey, metaKey, ctrlKey }, { typed, completion: k.shownCompletion, scope, offered: k.tabScope, scopeFrom: bar.scopeFrom });
    if (action?.kind === "enter") return bar.dispatch({ kind: "enteredScope", scope: action.scope, from: action.from });
    if (action?.kind === "leave") return bar.dispatch({ kind: "leftScope", restore: action.text });
    if (action?.kind === "accept") return bar.dispatch({ kind: "tabAccepted", text: action.text });
    if (key === "Tab") return move(shiftKey ? -1 : 1);
  }
  if (key === "Enter") {
    if (metaKey && shiftKey) return k.forceSearch();
    if (ctrlKey && !/[\s./:]/.test(typed.trim()) && typed.trim())
      return k.go(`https://www.${typed.trim()}.com`, shiftKey ? "newWindow" : "current");
    if (metaKey || altKey || shiftKey) return k.choose(current, dispositionFor({ metaKey, altKey, shiftKey }), true);
  }
}
