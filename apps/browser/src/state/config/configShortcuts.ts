import { COMMANDS, staticShortcutSources } from "../commands/commandCatalog";
import { formatShortcut, parseShortcut, sameShortcut, type Shortcut } from "../commands/shortcuts";

const MODIFIER_WORDS: Record<string, string> = {
  cmd: "⌘",
  command: "⌘",
  opt: "⌥",
  option: "⌥",
  alt: "⌥",
  ctrl: "⌃",
  control: "⌃",
  shift: "⇧",
  fn: "🌐",
};
const KEY_WORDS: Record<string, string> = {
  space: "Space",
  tab: "⇥",
  return: "↩",
  escape: "⎋",
  delete: "⌫",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  home: "↖",
  end: "↘",
  pageup: "⇞",
  pagedown: "⇟",
};
const MODIFIER_GLYPHS = new Set(Object.values(MODIFIER_WORDS));
const FUNCTION_KEY = /^F([1-9]|1\d|20)$/;
const WORD_FORM = /^((?:[a-z]+\+)*)(.+)$/i;

export const SHORTCUT_FORMAT =
  "One shortcut: modifiers cmd, opt (option, alt), ctrl (control), shift or fn joined by +, then one key " +
  "(a character, f1–f20, space, tab, return, escape, delete, up, down, left, right, home, end, pageup, pagedown), " +
  'as in "cmd+shift+t"; or in glyphs, as in "⇧⌘T". "" unbinds the command.';

function wordGlyphs(text: string): string | null {
  const m = WORD_FORM.exec(text);
  if (!m || !m[1]) return null;
  const words = m[1].slice(0, -1).split("+").map((w) => w.toLowerCase());
  if (!words.every((w) => Object.hasOwn(MODIFIER_WORDS, w))) return null;
  const key = m[2]!;
  return words.map((w) => MODIFIER_WORDS[w]).join("") + (keyGlyph(key) ?? key);
}

function keyGlyph(word: string): string | null {
  const lower = word.toLowerCase();
  if (Object.hasOwn(KEY_WORDS, lower)) return KEY_WORDS[lower]!;
  return /^f\d{1,2}$/.test(lower) ? lower.toUpperCase() : null;
}

export function parseConfigShortcut(text: string): Shortcut | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const glyphs = wordGlyphs(trimmed) ?? keyGlyph(trimmed) ?? trimmed;
  const chars = Array.from(glyphs);
  let at = 0;
  while (at < chars.length - 1 && MODIFIER_GLYPHS.has(chars[at]!)) at++;
  const name = chars.slice(at).join("");
  if (/^F\d+$/.test(name) && !FUNCTION_KEY.test(name)) return null;
  const shortcut = parseShortcut(glyphs);
  if (Array.from(shortcut.key).length !== 1 || MODIFIER_GLYPHS.has(shortcut.key)) return null;
  return shortcut;
}

type CommandEntry = { title: string; defaults: Shortcut[] };

let catalog: ReadonlyMap<string, CommandEntry> | null = null;

function titleOf(id: string): string {
  const [command, variant] = id.split(":") as [string, string | undefined];
  const spec = (COMMANDS as Record<string, { title?: string; variants?: Record<string, { title?: string }> }>)[command];
  return (variant ? spec?.variants?.[variant]?.title : spec?.title) ?? id;
}

export function shortcutCatalog(): ReadonlyMap<string, CommandEntry> {
  catalog ??= new Map(staticShortcutSources().map((source) => [source.id, { title: titleOf(source.id), defaults: source.keys }]));
  return catalog;
}

export const shortcutDescription = (entry: CommandEntry): string =>
  entry.defaults.length ? `${entry.title} (default ${entry.defaults.map(formatShortcut).join(", ")})` : `${entry.title} (no default)`;

export type ShortcutsResult = { overrides: Record<string, string[]>; problems: string[] };

export function configShortcuts(file: string, given: unknown, current: Readonly<Record<string, string[]>>): ShortcutsResult {
  if (typeof given !== "object" || given === null || Array.isArray(given)) return { overrides: { ...current }, problems: [`${file}: shortcuts must be an object of command id to shortcut`] };
  const overrides = { ...current };
  const problems: string[] = [];
  const commands = shortcutCatalog();
  for (const [id, value] of Object.entries(given)) {
    const entry = commands.get(id);
    if (!entry) {
      problems.push(id.startsWith("system:") ? `${file}: shortcuts.${id} can't be rebound` : `${file}: shortcuts.${id} isn't a command`);
      continue;
    }
    if (typeof value !== "string") {
      problems.push(`${file}: shortcuts.${id} must be a string like "cmd+shift+t", "⇧⌘T" or ""`);
      continue;
    }
    if (value.trim() === "") {
      overrides[id] = [""];
      continue;
    }
    const shortcut = parseConfigShortcut(value);
    if (!shortcut) {
      problems.push(`${file}: shortcuts.${id} "${value}" isn't a shortcut (try "cmd+shift+t" or "⇧⌘T")`);
      continue;
    }
    if (entry.defaults.some((key) => sameShortcut(shortcut, key))) delete overrides[id];
    else overrides[id] = [shortcut.key, ...shortcut.modifiers];
  }
  return { overrides, problems };
}
