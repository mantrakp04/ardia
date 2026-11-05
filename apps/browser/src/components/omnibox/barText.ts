import type { SearchScope } from "@ardia/core";
import type { BarSnapshot } from "../../state/omnibox/barState";

export type Selection = { start: number; end: number };

export type BarText = {
  typed: string;
  edited: boolean;
  suppressCompletion: boolean;
  selected: number;
  scope: SearchScope | null;
  scopeFrom: string;
  pendingSelection: Selection | null;
};

export type BarEvent =
  | { kind: "typed"; text: string; suppress: boolean; selected: number }
  | { kind: "edited"; text: string; caret: number }
  | { kind: "caretAccepted"; text: string }
  | { kind: "tabAccepted"; text: string }
  | { kind: "calculated"; text: string }
  | { kind: "completionDropped" }
  | { kind: "enteredScope"; scope: SearchScope; from: string }
  | { kind: "leftScope"; restore: string | null }
  | { kind: "reset"; selected: number }
  | { kind: "selected"; index: number }
  | { kind: "select"; selection: Selection }
  | { kind: "selectionApplied" };

export function initialBar(restored: BarSnapshot | null, initialText: string, noneSelected: number): BarText {
  return {
    typed: restored?.typed ?? initialText,
    edited: restored?.edited ?? false,
    suppressCompletion: true,
    selected: restored?.selected ?? noneSelected,
    scope: restored?.scope ?? null,
    scopeFrom: restored?.scopeFrom ?? "",
    pendingSelection: restored?.selection ?? (initialText ? { start: 0, end: initialText.length } : null),
  };
}

const caret = (at: number): Selection => ({ start: at, end: at });

export function barReducer(s: BarText, e: BarEvent): BarText {
  switch (e.kind) {
    case "typed":
      return { ...s, typed: e.text, edited: true, suppressCompletion: e.suppress, selected: e.selected };
    case "edited":
      return { ...s, typed: e.text, edited: true, suppressCompletion: true, selected: 0, pendingSelection: caret(e.caret) };
    case "caretAccepted":
      return { ...s, typed: e.text, suppressCompletion: true, selected: 0 };
    case "tabAccepted":
      return { ...s, typed: e.text, suppressCompletion: true, pendingSelection: caret(e.text.length) };
    case "calculated":
      return { ...s, typed: e.text, suppressCompletion: true, pendingSelection: { start: 0, end: e.text.length } };
    case "completionDropped":
      return { ...s, suppressCompletion: true };
    case "enteredScope":
      return { ...s, scope: e.scope, scopeFrom: e.from, typed: "", edited: true, selected: 0, suppressCompletion: true };
    case "leftScope":
      if (e.restore === null) return { ...s, scope: null, selected: 0, suppressCompletion: true };
      return { ...s, scope: null, typed: e.restore, edited: true, pendingSelection: caret(e.restore.length), selected: 0, suppressCompletion: true };
    case "reset":
      return { ...s, typed: "", edited: false, scope: null, selected: e.selected, suppressCompletion: true };
    case "selected":
      return { ...s, selected: e.index };
    case "select":
      return { ...s, pendingSelection: e.selection };
    case "selectionApplied":
      return { ...s, pendingSelection: null };
  }
}

const CARET_WITH_KEY_MS = 100;

export function selectionTracker(initial: Selection, now = Date.now) {
  let current = initial;
  let before = initial;
  let movedAt = 0;
  return {
    get current() {
      return current;
    },
    get before() {
      return before;
    },
    note(next: Selection) {
      if (current.start !== next.start || current.end !== next.end) {
        before = current;
        movedAt = now();
      }
      current = next;
    },
    collapse() {
      current = { start: 0, end: 0 };
    },
    beforeEdit: () => (now() - movedAt < CARET_WITH_KEY_MS ? before : current),
  };
}

export type SelectionTracker = ReturnType<typeof selectionTracker>;
