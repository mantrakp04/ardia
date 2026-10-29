import type { BrowserCommand } from "@ardia-real/shell";
import { emitAppEvent, emitCommand } from "@ardia/shell";
import { useBrowser } from "../../../../../browser/src/state/browser/store";
import { provideNativeModule } from "../../expo-modules-core";

type Mod = "cmd" | "shift" | "alt" | "ctrl";
type Shortcut = { code: string; mods: Mod[]; command: BrowserCommand; arg?: string | ((e: KeyboardEvent) => string | null); notInText?: boolean; reserved?: boolean };

const s = (code: string, mods: Mod[], command: BrowserCommand, extra: Partial<Shortcut> = {}): Shortcut => ({ code, mods, command, ...extra });

const digits = Array.from({ length: 9 }, (_, i) => i + 1);

const SHORTCUTS: Shortcut[] = [
  s("Comma", ["cmd"], "openSettings"),
  s("KeyT", ["cmd"], "newTab", { reserved: true }),
  s("KeyT", ["cmd", "alt"], "newTabInGroup"),
  s("KeyT", ["cmd", "shift"], "reopenClosedTab", { reserved: true }),
  s("KeyN", ["cmd"], "newWindow", { reserved: true }),
  s("KeyN", ["cmd", "shift"], "newIncognitoWindow", { reserved: true }),
  s("KeyN", ["cmd", "alt"], "newLittleArdia"),
  s("KeyN", ["cmd", "ctrl"], "newGroupWithTabs"),
  s("KeyO", ["cmd"], "openFile"),
  s("KeyL", ["cmd"], "focusCommandBar"),
  s("F5", ["ctrl"], "focusCommandBar"),
  s("KeyW", ["cmd"], "closeTab", { reserved: true }),
  s("KeyW", ["cmd", "ctrl"], "closeTabGroup"),
  s("KeyK", ["cmd", "shift"], "closeAllTabs"),
  s("KeyK", ["cmd", "alt"], "cleanUpTabs"),
  s("KeyI", ["cmd", "shift"], "emailPageLocation"),
  s("KeyP", ["cmd"], "print"),
  s("KeyP", ["cmd", "alt"], "printWithSystemDialog"),
  s("KeyP", ["cmd", "ctrl"], "newGroupWithTabs"),
  s("KeyC", ["cmd", "shift"], "copyUrl"),
  s("KeyC", ["cmd", "alt", "shift"], "copyUrlAsMarkdown"),
  s("KeyC", ["cmd", "ctrl"], "newTabInGroup"),
  s("KeyF", ["cmd"], "findInPage"),
  s("KeyF", ["cmd", "alt"], "findAndReplace"),
  s("KeyG", ["cmd"], "findNext"),
  s("KeyG", ["cmd", "shift"], "findPrevious"),
  s("KeyE", ["cmd"], "useSelectionForFind"),
  s("KeyJ", ["cmd"], "jumpToSelection"),
  s("Period", ["cmd"], "stop"),
  s("KeyR", ["cmd"], "reload"),
  s("KeyR", ["cmd", "shift"], "forceReload"),
  s("KeyS", ["cmd", "shift"], "toggleTabLayout"),
  s("KeyS", ["cmd"], "toggleSidebar"),
  s("KeyL", ["cmd", "shift"], "toggleSidebar"),
  s("KeyF", ["cmd", "shift"], "toggleSidebar"),
  s("Equal", ["ctrl", "shift"], "openSplitPane"),
  s("BracketRight", ["ctrl", "shift"], "focusNextPane"),
  s("BracketLeft", ["ctrl", "shift"], "focusPreviousPane"),
  s("KeyB", ["cmd", "shift"], "toggleBookmarksBar"),
  s("Digit0", ["cmd"], "zoomReset"),
  s("Equal", ["cmd"], "zoomIn"),
  s("Equal", ["cmd", "shift"], "zoomIn"),
  s("Minus", ["cmd"], "zoomOut"),
  s("KeyU", ["cmd", "alt"], "viewSource"),
  s("KeyI", ["cmd", "alt"], "devTools"),
  s("KeyC", ["cmd", "alt"], "inspectElements"),
  s("KeyJ", ["cmd", "alt"], "javaScriptConsole"),
  s("F12", [], "toggleDevTools"),
  s("F7", [], "caretBrowsing"),
  ...digits.slice(0, 8).map((n) => s(`Digit${n}`, ["cmd"], "selectTab", { arg: `${n}` })),
  s("Digit9", ["cmd"], "selectLastTab"),
  ...digits.map((n) => s(`Digit${n}`, ["ctrl"], "switchProfile", { arg: () => useBrowser.getState().profileOrder[n - 1] ?? null })),
  s("BracketLeft", ["cmd"], "back"),
  s("BracketRight", ["cmd"], "forward"),
  s("ArrowLeft", ["cmd"], "back", { notInText: true }),
  s("ArrowRight", ["cmd"], "forward", { notInText: true }),
  s("BracketRight", ["cmd", "shift"], "nextTab", { reserved: true }),
  s("BracketLeft", ["cmd", "shift"], "previousTab", { reserved: true }),
  s("ArrowRight", ["cmd", "alt"], "nextTab", { reserved: true }),
  s("ArrowLeft", ["cmd", "alt"], "previousTab", { reserved: true }),
  s("PageDown", ["ctrl"], "nextTab", { reserved: true }),
  s("PageUp", ["ctrl"], "previousTab", { reserved: true }),
  s("ArrowDown", ["cmd", "alt"], "nextTab"),
  s("ArrowUp", ["cmd", "alt"], "previousTab"),
  s("PageDown", ["ctrl", "shift"], "moveTabDown"),
  s("PageUp", ["ctrl", "shift"], "moveTabUp"),
  s("KeyA", ["cmd", "shift"], "searchTabs"),
  s("Tab", ["ctrl"], "tabSwitcher", { arg: "forward", reserved: true }),
  s("Tab", ["ctrl", "shift"], "tabSwitcher", { arg: "backward", reserved: true }),
  s("Enter", ["cmd"], "returnToPinnedUrl", { notInText: true }),
  s("KeyD", ["cmd"], "bookmarkPage"),
  s("KeyD", ["cmd", "shift"], "bookmarkAllTabs"),
  s("KeyB", ["cmd", "alt"], "manageBookmarks"),
  s("KeyY", ["cmd"], "showHistory"),
  s("Backspace", ["cmd", "shift"], "clearBrowsingData"),
  s("KeyJ", ["cmd", "shift"], "downloads"),
  s("KeyL", ["cmd", "alt"], "downloads"),
  s("KeyM", ["cmd", "shift"], "openProfileMenu"),
];

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const FALLBACK_SWAP: Partial<Record<Mod, Mod>> = isMac ? { cmd: "ctrl", ctrl: "alt" } : { cmd: "alt", ctrl: "alt" };

const fallbacks: Shortcut[] = SHORTCUTS.filter((sc) => sc.reserved).map((sc) => ({
  ...sc,
  mods: sc.mods.map((m) => FALLBACK_SWAP[m] ?? m),
  reserved: false,
}));

function modsOf(e: KeyboardEvent): Set<Mod> {
  const mods = new Set<Mod>();
  if (isMac ? e.metaKey : e.ctrlKey) mods.add("cmd");
  if (isMac && e.ctrlKey) mods.add("ctrl");
  if (!isMac && e.metaKey) mods.add("ctrl");
  if (e.altKey) mods.add("alt");
  if (e.shiftKey) mods.add("shift");
  return mods;
}

const sameMods = (wanted: Mod[], have: Set<Mod>) => wanted.length === have.size && wanted.every((m) => have.has(m));

const TEXT_ENTRY = "input, textarea, [contenteditable=''], [contenteditable='true']";
const inText = () => !!(document.activeElement instanceof Element && document.activeElement.matches(TEXT_ENTRY));

const CODE_ALIASES: Record<string, string> = { NumpadEnter: "Enter", NumpadAdd: "Equal", NumpadSubtract: "Minus" };

export function findShortcut(e: KeyboardEvent) {
  const have = modsOf(e);
  const code = CODE_ALIASES[e.code] ?? e.code;
  const matches = (sc: Shortcut) => sc.code === code && sameMods(sc.mods, have);
  return SHORTCUTS.find(matches) ?? fallbacks.find(matches) ?? null;
}

const switcher = { capturing: false, holding: null as Mod | null };

const holdKey = (mod: Mod) => (mod === "ctrl" ? "Control" : mod === "alt" ? "Alt" : mod === "cmd" ? (isMac ? "Meta" : "Control") : "Shift");

function onKeyDown(e: KeyboardEvent) {
  if (switcher.capturing && !(e.code === "Tab" && (e.ctrlKey || e.altKey))) {
    const key = e.key === "Escape" ? "escape" : e.key === "ArrowRight" ? "next" : e.key === "ArrowLeft" ? "previous" : null;
    if (key) emitAppEvent({ type: "switcherKey", key });
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const shortcut = findShortcut(e);
  if (!shortcut) return;
  if (shortcut.notInText && inText()) return;
  const arg = typeof shortcut.arg === "function" ? shortcut.arg(e) : (shortcut.arg ?? null);
  if (shortcut.command === "switchProfile" && !arg) return;
  e.preventDefault();
  e.stopPropagation();
  if (shortcut.command === "tabSwitcher") switcher.holding = shortcut.mods.find((m) => m !== "shift") ?? null;
  emitCommand({ command: shortcut.command, arg, windowId: useBrowser.getState().ui.focusOrder[0] ?? null });
}

function onKeyUp(e: KeyboardEvent) {
  if (!switcher.holding || e.key !== holdKey(switcher.holding)) return;
  switcher.holding = null;
  emitAppEvent({ type: "switcherReleased" });
}

function onPointerUp() {
  if (switcher.capturing) emitAppEvent({ type: "switcherMouseUp" });
}

function onBlur() {
  if (!switcher.holding) return;
  switcher.holding = null;
  emitAppEvent({ type: "switcherReleased" });
}

provideNativeModule("ArdiaFocus", {
  setSwitcherCapture: async (active: boolean) => void (switcher.capturing = active),
});

if (typeof window !== "undefined") {
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("blur", onBlur);
}

export const shortcutTable = () => [...SHORTCUTS, ...fallbacks].map(({ code, mods, command }) => ({ code, mods, command }));
