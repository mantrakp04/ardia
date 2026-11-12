import type { MenuItem } from "../../platform/menus";
import type { MenuShortcut } from "../../platform/commands";
import { create } from "zustand";
import { useBrowser } from "../browser/store";
import { shortcutSources } from "./commandCatalog";
import { formatShortcut, resolveShortcuts, type ResolvedShortcuts, type Shortcut, type ShortcutOverrides, type ShortcutSource } from "./shortcuts";

export { cancelShortcutRecording, recordShortcut, type MenuShortcut } from "../../platform/commands";

type MenuModifier = NonNullable<Extract<MenuItem, { id: string }>["modifiers"]>[number];
type MenuKey = { key?: string; modifiers?: MenuModifier[] };
type ShortcutState = { settings: { shortcuts: ShortcutOverrides }; profileOrder: readonly string[] };
type MenuBar = { listed: ReadonlySet<string>; fixed: readonly ShortcutSource[] };

const useMenuBar = create<{ bar: MenuBar | undefined; revision: number }>()(() => ({ bar: undefined, revision: 0 }));
let resolvedFor: { overrides: ShortcutOverrides; profiles: readonly string[]; menuBar: MenuBar | undefined; resolved: ResolvedShortcuts } | undefined;

export function setMenuBarShortcuts(items: readonly MenuShortcut[]) {
  const fixed = items.flatMap((item): ShortcutSource[] =>
    item.remappable ? [] : [{ id: item.id, fixed: true, keys: [{ key: item.key, modifiers: item.modifiers }] }],
  );
  const bar = { listed: new Set(items.map((item) => item.id)), fixed };
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

function commandAlternateOf(id: string, s: ShortcutState): Shortcut | null {
  const primary = shortcutOf(id, s);
  const modifiers = primary?.modifiers ?? [];
  if (modifiers.includes("command")) return null;
  const alternate: Shortcut = { key: primary?.key ?? "", modifiers: [...modifiers, "command"] };
  if (alternate.key && resolvedShortcuts(s).holdersOf(alternate).length) return null;
  return alternate;
}

export function menuCommandAlternate(id: string, s: ShortcutState = useBrowser.getState()): MenuKey | null {
  const alternate = commandAlternateOf(id, s);
  if (!alternate) return null;
  if (!alternate.key || alternate.modifiers.includes("function")) return { modifiers: ["command"] };
  return { key: alternate.key, modifiers: alternate.modifiers.filter((m): m is MenuModifier => m !== "function") };
}

const menuBarBindingsOf = new WeakMap<ResolvedShortcuts, Record<string, string[][]>>();
const stored = ({ key, modifiers }: Shortcut) => [key, ...modifiers];

export function menuBarBindings(s: ShortcutState): Record<string, string[][]> {
  const resolved = resolvedShortcuts(s);
  const cached = menuBarBindingsOf.get(resolved);
  if (cached) return cached;
  const fixed = new Set(useMenuBar.getState().bar?.fixed.map((source) => source.id));
  const bindings: Record<string, string[][]> = {};
  for (const [id, keys] of resolved.bindings) if (!fixed.has(id)) bindings[id] = keys.map(stored);
  for (const id of s.profileOrder) {
    const alternate = commandAlternateOf(`switchProfile:${id}`, s);
    bindings[`newWindow:${id}`] = alternate ? [stored(alternate)] : [];
  }
  menuBarBindingsOf.set(resolved, bindings);
  return bindings;
}

export function withShortcut(title: string, hint: string | undefined): string {
  return hint ? `${title} (${hint})` : title;
}

export function useShortcutHint(id: string): string | undefined {
  useMenuBar(() => shortcutHint(id));
  return useBrowser((s) => shortcutHint(id, s));
}
