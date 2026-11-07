import type { BrowserCommand, MenuShortcut, ShortcutModifier } from "@ardia-real/shell";
import { commandSpec, LINUX_STANDARD_ITEMS, shortcutSources } from "./commandCatalog";
import { resolveShortcuts, type ShortcutOverrides } from "./shortcutFormat";
import { BROWSER_WINDOW_COMMANDS } from "./browserCommandRoute";

export type Binding = { keyCode: number; modifiers: number; command: BrowserCommand; arg: string | null; notInText: boolean };

const modifierFlags: Record<ShortcutModifier, number> = { command: 4, control: 16, option: 8, shift: 2, function: 0 };
const specialKeys: Record<string, [string, number]> = {
  Comma: [",", 188], Period: [".", 190], Equal: ["=", 187], Minus: ["-", 189],
  Semicolon: [";", 186], Quote: ["'", 222], Backquote: ["`", 192], Backslash: ["\\", 220], Slash: ["/", 191],
  BracketLeft: ["[", 219], BracketRight: ["]", 221], Tab: ["\t", 9], Enter: ["\r", 13],
  Backspace: ["\u0008", 8], Delete: ["", 46], Escape: ["\u001b", 27], Space: [" ", 32],
  ArrowLeft: ["", 37], ArrowRight: ["", 39], ArrowUp: ["", 38], ArrowDown: ["", 40],
  PageUp: ["", 33], PageDown: ["", 34], Home: ["", 36], End: ["", 35],
};
const keyOf = (code: string): [string, number] | null => {
  if (/^Key[A-Z]$/.test(code)) return [code.slice(3).toLowerCase(), code.charCodeAt(3)];
  if (/^Digit[0-9]$/.test(code)) return [code.slice(5), code.charCodeAt(5)];
  if (/^F([1-9]|1[0-9]|20)$/.test(code)) return [String.fromCharCode(0xf703 + Number(code.slice(1))), 111 + Number(code.slice(1))];
  return specialKeys[code] ?? null;
};
const codeOf = (key: string): number | null => {
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase().charCodeAt(0);
  const point = key.charCodeAt(0);
  if (key.length === 1 && point >= 0xf704 && point <= 0xf717) return 112 + point - 0xf704;
  return Object.values(specialKeys).find(([value]) => value === key)?.[1] ?? null;
};
const commandOf = (id: string) => (LINUX_STANDARD_ITEMS[id]?.command ?? id.split(":")[0]) as BrowserCommand;
const argOf = (id: string) => id in LINUX_STANDARD_ITEMS || !id.includes(":") ? null : id.slice(id.indexOf(":") + 1);
const titleOf = (id: string) => {
  const standard = LINUX_STANDARD_ITEMS[id];
  if (standard) return standard.title;
  const [command, arg] = id.split(":");
  const spec = commandSpec(command!);
  return (arg && spec?.variants?.[arg]?.title) || spec?.title || `${command!.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}${arg ? ` ${arg}` : ""}`;
};
const pathOf = (command: string) => LINUX_STANDARD_ITEMS[command]?.path ?? (/Settings|Profile/.test(command) ? "Ardia" : /Tab|Window|Group/.test(command) ? "Tabs" : /find|Find|Selection|copy/.test(command) ? "Edit" : /bookmark|Bookmark/.test(command) ? "Bookmarks" : /History|Browsing|downloads|back|forward/.test(command) ? "History" : "View");

export function linuxMenuShortcuts(overrides: ShortcutOverrides = {}, profiles: readonly string[] = []): MenuShortcut[] {
  const sources = shortcutSources(profiles, Object.keys(overrides));
  const resolved = resolveShortcuts(sources, overrides);
  return sources.map((source) => {
    const defaults = source.keys[0] ?? { key: "", modifiers: [] };
    const effective = resolved.bindings.get(source.id)?.[0] ?? { key: "", modifiers: [] };
    return { id: source.id, title: titleOf(source.id), path: [pathOf(source.id)], ...effective,
      defaultKey: defaults.key, defaultModifiers: defaults.modifiers, remappable: true,
      aliases: source.keys.slice(1).map((shortcut) => [shortcut.key, ...shortcut.modifiers]) };
  });
}

export function linuxBindings(overrides: ShortcutOverrides = {}, profiles: readonly string[] = []): Binding[] {
  const resolved = resolveShortcuts(shortcutSources(profiles, Object.keys(overrides)), overrides);
  const bound = new Set<string>();
  return [...resolved.bindings].flatMap(([id, shortcuts]) => shortcuts.flatMap((shortcut) => {
    const keyCode = codeOf(shortcut.key);
    if (!keyCode || shortcut.modifiers.includes("function")) return [];
    const modifiers = shortcut.modifiers.reduce((flags, mod) => flags | modifierFlags[mod], 0);
    const combo = `${keyCode}:${modifiers}`;
    if (bound.has(combo)) return [];
    bound.add(combo);
    const command = commandOf(id);
    return [{ keyCode, modifiers, command, arg: argOf(id), notInText: command === "returnToPinnedUrl" }];
  }));
}

export const UTILITY_SHORTCUT_COMMANDS: ReadonlySet<string> = new Set(["closeTab", "openSettings", "findInPage", "quit", "copyDiagnostics", "recordPerformanceIssue", "taskManager", ...BROWSER_WINDOW_COMMANDS]);

export const utilityBindings = (bindings: Binding[]) => bindings.filter((binding) => UTILITY_SHORTCUT_COMMANDS.has(binding.command));

export function keyboardCombo(event: Pick<KeyboardEvent, "code" | "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">) {
  const key = keyOf(event.code)?.[0] ?? (event.key.length === 1 ? event.key.toLowerCase() : "");
  const modifiers: ShortcutModifier[] = [];
  if (event.ctrlKey) modifiers.push("command");
  if (event.metaKey) modifiers.push("control");
  if (event.altKey) modifiers.push("option");
  if (event.shiftKey) modifiers.push("shift");
  return { key, modifiers, keyCode: codeOf(key), flags: modifiers.reduce((flags, mod) => flags | modifierFlags[mod], 0) };
}

export function recordableShortcut(event: Pick<KeyboardEvent, "code" | "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">) {
  return !!keyboardCombo(event).key && (event.ctrlKey || event.metaKey || event.altKey || /^F\d+$/.test(event.code));
}

export function linuxNativeBindings(bindings: Binding[], profiles: readonly string[] = []) {
  const bound = new Set(bindings.map((binding) => `${binding.keyCode}:${binding.modifiers}`));
  return [...bindings, ...linuxBindings({}, profiles).filter((binding) => !bound.has(`${binding.keyCode}:${binding.modifiers}`)).map((binding) => ({ ...binding, suppressed: true }))];
}
