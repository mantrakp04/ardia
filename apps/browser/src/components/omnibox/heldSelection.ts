import { suggestionKey, type SearchScope, type Suggestion } from "@ardia/core";
import { useLayoutEffect, useRef } from "react";
import type { Disposition } from "../../state/omnibox/openFromBar";
import type { BarEvent } from "./barText";

type Held = { items: Suggestion[]; typed: string; scope: SearchScope | null; key: string | null };

export function heldIndex(prev: Held | null, items: Suggestion[], typed: string, scope: SearchScope | null, selectedIndex: number): number {
  if (!prev?.key || prev.items === items || prev.typed !== typed || prev.scope !== scope) return selectedIndex;
  const current = items[selectedIndex];
  if (current && suggestionKey(current) === prev.key) return selectedIndex;
  const at = items.findIndex((s) => suggestionKey(s) === prev.key);
  return at >= 0 ? at : selectedIndex;
}

export function useHeldSelection(items: Suggestion[], typed: string, scope: SearchScope | null, selectedIndex: number, dispatch: (e: BarEvent) => void) {
  const held = useRef<Held | null>(null);
  useLayoutEffect(() => {
    const at = heldIndex(held.current, items, typed, scope, selectedIndex);
    if (at !== selectedIndex) return dispatch({ kind: "selected", index: at });
    const current = items[selectedIndex];
    held.current = { items, typed, scope, key: current ? suggestionKey(current) : null };
  });
}

export function useProviderEnter(items: Suggestion[], typed: string, scope: SearchScope | null, choose: (s: Suggestion, disposition: Disposition) => void) {
  const pending = useRef<{ typed: string; scope: SearchScope; disposition: Disposition } | null>(null);
  const latest = useRef(choose);
  latest.current = choose;
  useLayoutEffect(() => {
    const wait = pending.current;
    if (!wait) return;
    if (wait.typed !== typed || wait.scope !== scope) {
      pending.current = null;
      return;
    }
    const first = items[0];
    if (first?.kind !== "provider") return;
    pending.current = null;
    latest.current(first, wait.disposition);
  }, [items, typed, scope]);
  return (disposition: Disposition): boolean => {
    if (scope?.kind !== "provider" || !typed.trim()) return false;
    pending.current = { typed, scope, disposition };
    return true;
  };
}
