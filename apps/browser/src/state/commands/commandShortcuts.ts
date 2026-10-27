import type { MenuItem } from "../../platform/menus";
import type { MenuShortcut } from "../../platform/commands";
import { create } from "zustand";
import { useBrowser } from "../browser/store";
import { shortcutSources } from "./commandCatalog";
import { formatShortcut, resolveShortcuts, storedShortcut, type ResolvedShortcuts, type Shortcut, type ShortcutOverrides, type ShortcutSource } from "./shortcuts";

export { cancelShortcutRecording, recordShortcut, type MenuShortcut } from "../../platform/commands";

type MenuModifier = NonNullable<Extract<MenuItem, { id: string }>["modifiers"]>[number];
type MenuKey = { key?: string; modifiers?: MenuModifier[] };
type ShortcutState = { settings: { shortcuts: ShortcutOverrides }; profileOrder: readonly string[] };
type MenuBar = { listed: ReadonlySet<string>; fixed: readonly ShortcutSource[] };

const useMenuBar = create<{ bar: MenuBar | undefined; revision: number }>()(() => ({ bar: undefined, revision: 0 }));
let resolvedFor: { overrides: ShortcutOverrides; profiles: readonly string[]; menuBar: MenuBar | undefined; resolved: ResolvedShortcuts } | undefined;

const fixedSource = (item: MenuShortcut): ShortcutSource => ({
  id: item.id,
  fixed: true,
  keys: [{ key: item.defaultKey, modifiers: item.defaultModifiers }, ...(item.aliases ?? []).map(storedShortcut)],
});

export function setMenuBarShortcuts(items: readonly MenuShortcut[]) {
  const bar = { listed: new Set(items.map((item) => item.id)), fixed: items.filter((item) => !item.remappable).map(fixedSource) };
  useMenuBar.setState((m) => ({ bar, revision: m.revision + 1 }));
}

export const menuBarRevision = () => useMenuBar.getState().revision;
export const useMenuBarRevision = () => useMenuBar((m) => m.revision);

export function resolvedShortcuts({ settings, profileOrder }: ShortcutState): ResolvedShortcuts {
  const overrides = settings.shortcuts;
  const bar = useMenuBar.getState().bar;
  if (resolvedFor?.overrides !== overrides || resolvedFor.profiles !== profileOrder || resolvedFor.menuBar !== bar) {
    const catalog = shortcutSources(profileOrder, Object.keys(overrides));
    const sources = bar ? [...catalog.filter((source) => bar.listed.has(source.id)), ...bar.fixed] : catalog;
    resolvedFor = { overrides, profiles: profileOrder, menuBar: bar, resolved: resolveShortcuts(sources, overrides) };
  }
  return resolvedFor.resolved;
}

export const shortcutOf = (id: string, s: ShortcutState = useBrowser.getState()): Shortcut | undefined => resolvedShortcuts(s).bindings.get(id)?.[0];

export function shortcutHint(id: string, s: ShortcutState = useBrowser.getState()): string | undefined {
  const shortcut = shortcutOf(id, s);
  return shortcut && formatShortcut(shortcut);
}

export function menuShortcut(id: string, s: ShortcutState = useBrowser.getState()): MenuKey {
  const shortcut = shortcutOf(id, s);
  if (!shortcut || shortcut.modifiers.includes("function")) return {};
  return { key: shortcut.key, modifiers: shortcut.modifiers.filter((m): m is MenuModifier => m !== "function") };
}

export function menuCommandAlternate(id: string, s: ShortcutState = useBrowser.getState()): MenuKey | null {
  const primary = menuShortcut(id, s);
  const modifiers = primary.modifiers ?? [];
  if (modifiers.includes("command")) return null;
  const alternate = { ...primary, modifiers: [...modifiers, "command" as const] };
  if (alternate.key && resolvedShortcuts(s).holdersOf({ key: alternate.key, modifiers: alternate.modifiers }).length) return null;
  return alternate;
}

export function withShortcut(title: string, hint: string | undefined): string {
  return hint ? `${title} (${hint})` : title;
}

export function useShortcutHint(id: string): string | undefined {
  useMenuBar(() => shortcutHint(id));
  return useBrowser((s) => shortcutHint(id, s));
}
