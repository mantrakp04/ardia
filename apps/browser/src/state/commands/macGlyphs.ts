import type { ShortcutModifier } from "../../platform/commands";
import { FIRST_FUNCTION_KEY, LAST_FUNCTION_KEY, MODIFIER_ORDER, ordered } from "./modifiers";
import type { Shortcut } from "./shortcuts";

export const MODIFIER_GLYPHS: Record<ShortcutModifier, string> = { control: "⌃", option: "⌥", shift: "⇧", command: "⌘", function: "🌐" };
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
export const GLYPH_KEYS: Record<string, string> = {
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

export function formatMacShortcut({ key, modifiers }: Shortcut): string {
  if (!key) return "";
  const code = key.charCodeAt(0);
  const name = KEY_GLYPHS[key] ?? (code >= FIRST_FUNCTION_KEY && code <= LAST_FUNCTION_KEY ? `F${code - FIRST_FUNCTION_KEY + 1}` : key.toUpperCase());
  return ordered(modifiers).map((m) => MODIFIER_GLYPHS[m]).join("") + name;
}

export function parseMacShortcut(text: string): Shortcut {
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
