import type { ShortcutModifier } from "../../platform/commands";
import { isModifier, ordered } from "./modifiers";

import { storedModifiers } from "./keyNotation";

export { formatShortcut, parseShortcut } from "./keyNotation";

export type Shortcut = { key: string; modifiers: ShortcutModifier[] };
export type ShortcutSource = { id: string; keys: Shortcut[]; fixed?: boolean };
export type ShortcutOverrides = Record<string, string[]>;
export type ResolvedShortcuts = {
  bindings: ReadonlyMap<string, Shortcut[]>;
  defaultsOf(id: string): Shortcut[];
  conflictsOf(id: string): string[];
  holdersOf(shortcut: Shortcut): string[];
};

type ModifierReading = (modifiers: readonly ShortcutModifier[]) => ShortcutModifier[];

export function storedShortcut(stored: readonly string[], read: ModifierReading = storedModifiers): Shortcut {
  const key = stored[0] ?? "";
  const modifiers = read(stored.slice(1).filter(isModifier));
  const shifted = Array.from(key).length === 1 && key !== key.toLowerCase();
  return { key: shifted ? key.toLowerCase() : key, modifiers: ordered(shifted ? [...modifiers, "shift"] : modifiers) };
}

export function comboKey({ key, modifiers }: Shortcut): string {
  const shifted = key !== key.toLowerCase() ? ["shift"] : [];
  return `${ordered([...modifiers, ...shifted]).join("+")}|${key.toLowerCase()}`;
}

export const sameShortcut = (a: Shortcut, b: Shortcut) => comboKey(a) === comboKey(b);

export function resolveShortcuts(sources: readonly ShortcutSource[], overrides: ShortcutOverrides, read: ModifierReading = storedModifiers): ResolvedShortcuts {
  const rebindable = new Set(sources.filter((s) => !s.fixed).map((s) => s.id));
  const taken = new Set<string>();
  for (const [id, stored] of Object.entries(overrides)) {
    if (rebindable.has(id) && stored[0]) taken.add(comboKey(storedShortcut(stored, read)));
  }
  const bindings = new Map<string, Shortcut[]>();
  const holders = new Map<string, string[]>();
  for (const source of sources) {
    const stored = source.fixed ? undefined : overrides[source.id];
    const candidates = stored ? [storedShortcut(stored, read)] : source.keys.filter((k) => source.fixed || !taken.has(comboKey(k)));
    const seen = new Set<string>();
    const keys = candidates.filter((k) => k.key && !seen.has(comboKey(k)) && seen.add(comboKey(k)));
    bindings.set(source.id, keys);
    for (const combo of seen) holders.set(combo, [...(holders.get(combo) ?? []), source.id]);
  }
  const defaults = new Map(sources.map((source) => [source.id, source.keys]));
  return {
    bindings,
    defaultsOf: (id) => defaults.get(id) ?? [],
    holdersOf: (shortcut) => holders.get(comboKey(shortcut)) ?? [],
    conflictsOf: (id) => [...new Set((bindings.get(id) ?? []).flatMap((k) => holders.get(comboKey(k)) ?? []))].filter((other) => other !== id),
  };
}
