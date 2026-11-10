import type { ShortcutModifier } from "../../platform/commands";

export { formatMacShortcut as formatShortcut, parseMacShortcut as parseShortcut } from "./macGlyphs";

export const ALTERNATE_MODIFIER: Extract<ShortcutModifier, "command" | "control"> = "command";

export const defaultKeys = (_id: string, keys: readonly string[] | undefined): readonly string[] => keys ?? [];

export const profileSwitchKey = (n: number): string => `⌃${n}`;
