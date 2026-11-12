import { COMMANDS, STANDARD_ITEMS, type CommandSpec } from "./commandCatalog";
import { MODIFIER_GLYPHS, parseMacShortcut } from "./macGlyphs";
import { comboKey, type Shortcut } from "./shortcuts";
import { formatWindowsShortcut, parseWindowsShortcut, windowsKeysPaired, windowsModifiers, windowsProfileSwitchKey } from "./windowsKeys";

type Keyed = Pick<CommandSpec, "keys" | "variants">;

const KEYS_WITHOUT_A_COMMAND: Readonly<Record<string, string>> = { "⌘Q": "Alt+F4" };
const UNICODE_MINUS = "\u2212";
const MODIFIER_NAMES = { control: "Ctrl", option: "Alt", shift: "Shift" } as const;
const GLYPH_MODIFIERS = new Map(Object.entries(MODIFIER_GLYPHS).map(([modifier, glyph]) => [glyph, modifier as keyof typeof MODIFIER_GLYPHS]));

let byMacCombo: Map<string, Shortcut | null> | undefined;

function windowsCombos(): Map<string, Shortcut | null> {
  if (byMacCombo) return byMacCombo;
  byMacCombo = new Map();
  const add = (id: string, keys: readonly string[] | undefined) => {
    const paired = windowsKeysPaired(id);
    (keys ?? []).forEach((key, i) => {
      const combo = comboKey(parseMacShortcut(key));
      const windows = paired[i];
      if (!byMacCombo!.has(combo)) byMacCombo!.set(combo, windows ? parseWindowsShortcut(windows) : null);
    });
  };
  for (const [command, spec] of Object.entries(COMMANDS as Readonly<Record<string, Keyed>>)) {
    add(command, spec.keys);
    for (const [arg, variant] of Object.entries(spec.variants ?? {})) add(`${command}:${arg}`, variant.keys);
  }
  for (const [id, item] of Object.entries(STANDARD_ITEMS)) add(id, item.keys);
  for (let n = 1; n <= 9; n++) byMacCombo.set(comboKey(parseMacShortcut(`⌃${n}`)), parseWindowsShortcut(windowsProfileSwitchKey(n)));
  return byMacCombo;
}

export function windowsKeyText(mac: string): string {
  if (Object.hasOwn(KEYS_WITHOUT_A_COMMAND, mac)) return KEYS_WITHOUT_A_COMMAND[mac]!;
  const glyphs = Array.from(mac);
  if (glyphs.length && glyphs.every((g) => GLYPH_MODIFIERS.has(g))) {
    return windowsModifiers(glyphs.map((g) => GLYPH_MODIFIERS.get(g)!)).map((m) => MODIFIER_NAMES[m as keyof typeof MODIFIER_NAMES]).join("+");
  }
  const shortcut = parseMacShortcut(mac.replaceAll(UNICODE_MINUS, "-"));
  return formatWindowsShortcut(windowsCombos().get(comboKey(shortcut)) ?? shortcut);
}
