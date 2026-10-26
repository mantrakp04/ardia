import type { ShortcutModifier } from "../../platform/commands";

export type Shortcut = { key: string; modifiers: ShortcutModifier[] };
export type ShortcutSource = { id: string; keys: Shortcut[]; fixed?: boolean };
export type ShortcutOverrides = Record<string, string[]>;
export type ResolvedShortcuts = {
  bindings: ReadonlyMap<string, Shortcut[]>;
  conflictsOf(id: string): string[];
  holdersOf(shortcut: Shortcut): string[];
};

const MODIFIER_ORDER: ShortcutModifier[] = ["control", "option", "shift", "command", "function"];
const MODIFIER_GLYPHS: Record<ShortcutModifier, string> = { control: "⌃", option: "⌥", shift: "⇧", command: "⌘", function: "🌐" };
const KEY_GLYPHS: Record<string, string> = {
  "\t": "⇥",
  "\r": "↩",
  "\u0003": "⌤",
  "\u0008": "⌫",
  "\u007f": "⌫",
  "": "⌦",
  "\u001b": "⎋",
  " ": "Space",
  "": "↑",
  "": "↓",
  "": "←",
  "": "→",
  "": "↖",
  "": "↘",
  "": "⇞",
  "": "⇟",
};
const GLYPH_KEYS: Record<string, string> = {
  "⇥": "\t",
  "↩": "\r",
  "⌤": "\u0003",
  "⌫": "\u0008",
  "⌦": "",
  "⎋": "\u001b",
  Space: " ",
  "↑": "",
  "↓": "",
  "←": "",
  "→": "",
  "↖": "",
  "↘": "",
  "⇞": "",
  "⇟": "",
};
const FIRST_FUNCTION_KEY = 0xf704;
const LAST_FUNCTION_KEY = 0xf717;

const isModifier = (name: string): name is ShortcutModifier => (MODIFIER_ORDER as string[]).includes(name);
const ordered = (names: Iterable<string>): ShortcutModifier[] => {
  const set = new Set(names);
  return MODIFIER_ORDER.filter((m) => set.has(m));
};

export function formatShortcut({ key, modifiers }: Shortcut): string {
  if (!key) return "";
  const code = key.charCodeAt(0);
  const name = KEY_GLYPHS[key] ?? (code >= FIRST_FUNCTION_KEY && code <= LAST_FUNCTION_KEY ? `F${code - FIRST_FUNCTION_KEY + 1}` : key.toUpperCase());
  return ordered(modifiers).map((m) => MODIFIER_GLYPHS[m]).join("") + name;
}

export function parseShortcut(text: string): Shortcut {
  const glyphs = Array.from(text);
  const modifiers: ShortcutModifier[] = [];
  let i = 0;
  for (; i < glyphs.length - 1; i++) {
    const modifier = MODIFIER_ORDER.find((m) => MODIFIER_GLYPHS[m] === glyphs[i]);
    if (!modifier) break;
    modifiers.push(modifier);
  }
  const name = glyphs.slice(i).join("");
  const functionKey = /^F(\d{1,2})$/.exec(name);
  const key = GLYPH_KEYS[name] ?? (functionKey ? String.fromCharCode(FIRST_FUNCTION_KEY + Number(functionKey[1]) - 1) : name.toLowerCase());
  return { key, modifiers: ordered(modifiers) };
}

export function storedShortcut(stored: readonly string[]): Shortcut {
  const key = stored[0] ?? "";
  const modifiers = stored.slice(1).filter(isModifier);
  const shifted = Array.from(key).length === 1 && key !== key.toLowerCase();
  return { key: shifted ? key.toLowerCase() : key, modifiers: ordered(shifted ? [...modifiers, "shift"] : modifiers) };
}

export function comboKey({ key, modifiers }: Shortcut): string {
  const shifted = key !== key.toLowerCase() ? ["shift"] : [];
  return `${ordered([...modifiers, ...shifted]).join("+")}|${key.toLowerCase()}`;
}

export const sameShortcut = (a: Shortcut, b: Shortcut) => comboKey(a) === comboKey(b);

export function resolveShortcuts(sources: readonly ShortcutSource[], overrides: ShortcutOverrides): ResolvedShortcuts {
  const rebindable = new Set(sources.filter((s) => !s.fixed).map((s) => s.id));
  const taken = new Set<string>();
  for (const [id, stored] of Object.entries(overrides)) {
    if (rebindable.has(id) && stored[0]) taken.add(comboKey(storedShortcut(stored)));
  }
  const bindings = new Map<string, Shortcut[]>();
  const holders = new Map<string, string[]>();
  for (const source of sources) {
    const stored = source.fixed ? undefined : overrides[source.id];
    const candidates = stored ? [storedShortcut(stored)] : source.keys.filter((k) => source.fixed || !taken.has(comboKey(k)));
    const seen = new Set<string>();
    const keys = candidates.filter((k) => k.key && !seen.has(comboKey(k)) && seen.add(comboKey(k)));
    bindings.set(source.id, keys);
    for (const combo of seen) holders.set(combo, [...(holders.get(combo) ?? []), source.id]);
  }
  return {
    bindings,
    holdersOf: (shortcut) => holders.get(comboKey(shortcut)) ?? [],
    conflictsOf: (id) => [...new Set((bindings.get(id) ?? []).flatMap((k) => holders.get(comboKey(k)) ?? []))].filter((other) => other !== id),
  };
}
