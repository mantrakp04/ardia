import type { ShortcutModifier } from "../../platform/commands";

export const MODIFIER_ORDER: readonly ShortcutModifier[] = ["control", "option", "shift", "command", "function"];
export const FIRST_FUNCTION_KEY = 0xf704;
export const LAST_FUNCTION_KEY = 0xf717;

export const isModifier = (name: string): name is ShortcutModifier => (MODIFIER_ORDER as string[]).includes(name);
export const ordered = (names: Iterable<string>): ShortcutModifier[] => {
  const set = new Set(names);
  return MODIFIER_ORDER.filter((m) => set.has(m));
};
