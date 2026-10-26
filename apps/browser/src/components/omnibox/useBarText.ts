import type { SearchScope } from "@ardia/core";
import { useRef, useState } from "react";
import { savedNtpQuery } from "../../state/omnibox/barState";

export type Selection = { start: number; end: number };

export function useBarText(hero: boolean, tabId: string, initialText: string, noneSelected: number) {
  const [restored] = useState(() => (hero ? savedNtpQuery(tabId) : null));
  const [typed, setTyped] = useState(restored?.typed ?? initialText);
  const [edited, setEdited] = useState(restored?.edited ?? false);
  const [suppressCompletion, setSuppressCompletion] = useState(true);
  const [selected, setSelected] = useState(restored?.selected ?? noneSelected);
  const [scope, setScope] = useState<SearchScope | null>(restored?.scope ?? null);
  const scopeFrom = useRef(restored?.scopeFrom ?? "");
  const [pendingSelection, setPendingSelection] = useState<Selection | null>(
    restored?.selection ?? (initialText ? { start: 0, end: initialText.length } : null),
  );
  const selection = useRef<Selection>(restored?.selection ?? { start: 0, end: typed.length });
  const selectionBefore = useRef<Selection>(selection.current);
  const selectionAt = useRef(0);
  const noteSelection = (next: Selection) => {
    const now = selection.current;
    if (now.start !== next.start || now.end !== next.end) {
      selectionBefore.current = now;
      selectionAt.current = Date.now();
    }
    selection.current = next;
  };

  const enterScope = (next: SearchScope, from: string) => {
    scopeFrom.current = from;
    setScope(next);
    setTyped("");
    setEdited(true);
    setSelected(0);
    setSuppressCompletion(true);
  };

  const leaveScope = (restore: string | null) => {
    setScope(null);
    if (restore !== null) {
      setTyped(restore);
      setEdited(true);
      setPendingSelection({ start: restore.length, end: restore.length });
    }
    setSelected(0);
    setSuppressCompletion(true);
  };

  return {
    typed,
    setTyped,
    edited,
    setEdited,
    suppressCompletion,
    setSuppressCompletion,
    selected,
    setSelected,
    scope,
    setScope,
    scopeFrom,
    pendingSelection,
    setPendingSelection,
    selection,
    selectionBefore,
    selectionAt,
    noteSelection,
    enterScope,
    leaveScope,
  };
}
