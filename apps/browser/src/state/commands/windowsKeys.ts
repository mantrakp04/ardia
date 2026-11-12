import type { ShortcutModifier } from "../../platform/commands";
import { FIRST_FUNCTION_KEY, ordered } from "./modifiers";
import { GLYPH_KEYS, parseMacShortcut } from "./macGlyphs";
import type { Shortcut } from "./shortcuts";

export const WINDOWS_KEYS: Readonly<Record<string, readonly (string | null)[]>> = {
  openSettings: ["Ctrl+,"],
  newTab: ["Ctrl+T"],
  newTabInGroup: ["Ctrl+Alt+T", null],
  newWindow: ["Ctrl+N"],
  newIncognitoWindow: ["Ctrl+Shift+N"],
  newLittleArdia: ["Ctrl+Alt+N"],
  reopenClosedTab: ["Ctrl+Shift+T"],
  openFile: ["Ctrl+O"],
  focusCommandBar: ["Ctrl+L", null, "Alt+D"],
  "std:closeWindow:": ["Ctrl+Shift+W"],
  closeTab: ["Ctrl+W", "Ctrl+F4"],
  closeAllTabs: ["Ctrl+Shift+K"],
  cleanUpTabs: ["Ctrl+Alt+K"],
  share: ["Ctrl+Alt+S"],
  emailPageLocation: [null],
  print: ["Ctrl+P"],
  printWithSystemDialog: ["Ctrl+Shift+P"],
  copyUrl: ["Ctrl+Shift+C"],
  copyUrlAsMarkdown: ["Ctrl+Alt+Shift+C"],
  findInPage: ["Ctrl+F"],
  findAndReplace: ["Ctrl+Shift+H"],
  findNext: ["Ctrl+G", "F3"],
  findPrevious: ["Ctrl+Shift+G", "Shift+F3"],
  useSelectionForFind: ["Ctrl+E"],
  jumpToSelection: [null],
  stop: ["Ctrl+."],
  reload: ["Ctrl+R", "F5"],
  forceReload: ["Ctrl+Shift+R", "Ctrl+F5", "Shift+F5"],
  toggleTabLayout: ["Ctrl+Shift+S"],
  toggleSidebar: ["Ctrl+S", "Ctrl+Shift+L", "Ctrl+Shift+F"],
  openSplitPane: ["Ctrl+\\", null],
  focusNextPane: ["Alt+Shift+]", null],
  focusPreviousPane: ["Alt+Shift+[", null],
  toggleBookmarksBar: ["Ctrl+Shift+B"],
  zoomReset: ["Ctrl+0"],
  zoomIn: ["Ctrl+Plus", "Ctrl+="],
  zoomOut: ["Ctrl+-"],
  "std:toggleFullScreen:": [null, null, "F11"],
  viewSource: ["Ctrl+U"],
  devTools: ["Ctrl+Shift+I"],
  inspectElements: ["Ctrl+Alt+C"],
  javaScriptConsole: ["Ctrl+Shift+J"],
  toggleDevTools: ["F12"],
  caretBrowsing: ["F7"],
  back: ["Ctrl+[", "Alt+Left"],
  forward: ["Ctrl+]", "Alt+Right"],
  nextTab: ["Ctrl+Shift+]", "Ctrl+}", "Ctrl+PgDn", null],
  previousTab: ["Ctrl+Shift+[", "Ctrl+{", "Ctrl+PgUp", null],
  moveTabDown: ["Ctrl+Shift+PgDn"],
  moveTabUp: ["Ctrl+Shift+PgUp"],
  searchTabs: ["Ctrl+Shift+A"],
  "tabSwitcher:forward": ["Ctrl+Tab"],
  "tabSwitcher:backward": ["Ctrl+Shift+Tab"],
  returnToPinnedUrl: ["Alt+Home"],
  "selectTab:1": ["Ctrl+1"],
  "selectTab:2": ["Ctrl+2"],
  "selectTab:3": ["Ctrl+3"],
  "selectTab:4": ["Ctrl+4"],
  "selectTab:5": ["Ctrl+5"],
  "selectTab:6": ["Ctrl+6"],
  "selectTab:7": ["Ctrl+7"],
  "selectTab:8": ["Ctrl+8"],
  selectLastTab: ["Ctrl+9"],
  togglePinnedRow: ["Ctrl+Alt+Shift+D"],
  newGroupWithTabs: ["Ctrl+Alt+G", null],
  closeTabGroup: ["Ctrl+Alt+W"],
  bookmarkPage: ["Ctrl+D"],
  bookmarkAllTabs: ["Ctrl+Shift+D"],
  manageBookmarks: ["Ctrl+Shift+O"],
  showHistory: ["Ctrl+H"],
  clearBrowsingData: ["Ctrl+Shift+Del"],
  "std:performMiniaturize:": [null],
  "std:miniaturizeAll:": [null],
  downloads: ["Ctrl+J", null],
  taskManager: ["Shift+Esc"],
  nextProfile: [null],
  previousProfile: [null],
  openProfileMenu: ["Ctrl+Shift+M"],
  reportProblem: ["Ctrl+Alt+Shift+I"],
};

export const WINDOWS_ALTERNATE_MODIFIER: Extract<ShortcutModifier, "command" | "control"> = "control";

export const windowsKeysPaired = (id: string): readonly (string | null)[] => (Object.hasOwn(WINDOWS_KEYS, id) ? WINDOWS_KEYS[id]! : []);

export const windowsDefaultKeys = (id: string, _macKeys?: readonly string[]): readonly string[] => windowsKeysPaired(id).filter((key): key is string => key !== null);

export const windowsProfileSwitchKey = (n: number): string => `Alt+${n}`;

const LAST_WINDOWS_FUNCTION_KEY = FIRST_FUNCTION_KEY + 23;

const MODIFIER_NAMES: Partial<Record<ShortcutModifier, string>> = { control: "Ctrl", option: "Alt", shift: "Shift" };
const MODIFIER_WORDS: Readonly<Record<string, ShortcutModifier>> = {
  ctrl: "control",
  control: "control",
  cmd: "control",
  command: "control",
  alt: "option",
  option: "option",
  opt: "option",
  shift: "shift",
};
const KEY_NAMES: Readonly<Record<string, string>> = {
  "": "Left",
  "": "Right",
  "": "Up",
  "": "Down",
  "": "PgUp",
  "": "PgDn",
  "": "Home",
  "": "End",
  "": "Del",
  "": "Ins",
  "\u0008": "Backspace",
  "\u007f": "Backspace",
  "\t": "Tab",
  "\r": "Enter",
  "\u0003": "Enter",
  "\u001b": "Esc",
  " ": "Space",
  "+": "Plus",
};
const KEY_WORDS: Readonly<Record<string, string>> = {
  left: "",
  right: "",
  up: "",
  down: "",
  pgup: "",
  pageup: "",
  pgdn: "",
  pagedown: "",
  home: "",
  end: "",
  del: "",
  delete: "",
  ins: "",
  insert: "",
  backspace: "\u0008",
  tab: "\t",
  enter: "\r",
  return: "\r",
  esc: "\u001b",
  escape: "\u001b",
  space: " ",
  plus: "+",
};

export const windowsModifiers = (modifiers: Iterable<ShortcutModifier>): ShortcutModifier[] =>
  ordered([...modifiers].flatMap((m) => (m === "command" ? ["control"] : m === "function" ? [] : [m])));

export function windowsKeyName(key: string): string {
  const code = key.charCodeAt(0);
  if (code >= FIRST_FUNCTION_KEY && code <= LAST_WINDOWS_FUNCTION_KEY) return `F${code - FIRST_FUNCTION_KEY + 1}`;
  if (Object.hasOwn(KEY_NAMES, key)) return KEY_NAMES[key]!;
  return key.length > 1 ? key[0]!.toUpperCase() + key.slice(1) : key.toUpperCase();
}

export function formatWindowsShortcut({ key, modifiers }: Shortcut): string {
  if (!key) return "";
  return [...windowsModifiers(modifiers).map((m) => MODIFIER_NAMES[m]), windowsKeyName(key)].join("+");
}

function windowsKey(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (Object.hasOwn(KEY_WORDS, lower)) return KEY_WORDS[lower];
  if (Object.hasOwn(GLYPH_KEYS, name)) return GLYPH_KEYS[name];
  const functionKey = /^f(\d{1,2})$/.exec(lower);
  if (functionKey && Number(functionKey[1]) >= 1 && Number(functionKey[1]) <= 24) return String.fromCharCode(FIRST_FUNCTION_KEY + Number(functionKey[1]) - 1);
  return Array.from(name).length === 1 ? lower : undefined;
}

export function parseWindowsShortcut(text: string): Shortcut {
  const parts = text.endsWith("++") ? [...text.slice(0, -2).split("+"), "+"] : text.split("+");
  const name = parts.pop() ?? "";
  const modifiers = parts.map((part) => (Object.hasOwn(MODIFIER_WORDS, part.toLowerCase()) ? MODIFIER_WORDS[part.toLowerCase()] : undefined));
  const key = name ? windowsKey(name) : undefined;
  if (key !== undefined && modifiers.every((m) => m !== undefined)) return { key, modifiers: ordered(modifiers as ShortcutModifier[]) };
  const glyphs = parseMacShortcut(text);
  return { key: glyphs.key, modifiers: windowsModifiers(glyphs.modifiers) };
}
