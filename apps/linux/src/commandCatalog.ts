import { COMMANDS, shortcutSources as sharedSources, staticShortcutSources as sharedStaticSources } from "../../browser/src/state/commands/commandCatalog";
import { parseShortcut, storedShortcut, type Shortcut, type ShortcutSource } from "../../browser/src/state/commands/shortcuts";
import { linuxCapabilities, unavailableCommands } from "./hostCapabilities";
import { SHIFTED_KEYS } from "./shortcutOverrides";

export * from "../../browser/src/state/commands/commandCatalog";

const linuxKeys: Record<string, readonly string[]> = {
  focusCommandBar: ["⌘L", "F6", "⌥D"],
  reload: ["⌘R", "F5"],
  forceReload: ["⇧⌘R", "⇧F5"],
  devTools: ["⇧⌘I", "⌥⌘I"],
  emailPageLocation: [],
  jumpToSelection: [],
  downloads: ["⌘J", "⌥⌘L"],
  javaScriptConsole: ["⇧⌘J", "⌥⌘J"],
  inspectElements: ["⇧⌘C", "⌥⌘C"],
  copyUrl: [],
  zoomIn: ["⌘=", "⇧⌘="],
  back: ["⌘[", "⌥←"],
  forward: ["⌘]", "⌥→"],
  nextTab: ["⇧⌘]", "⌥⌘→", "⌘⇟", "⌥⌘↓"],
  previousTab: ["⇧⌘[", "⌥⌘←", "⌘⇞", "⌥⌘↑"],
  "tabSwitcher:forward": ["⌘⇥"],
  "tabSwitcher:backward": ["⇧⌘⇥"],
  "std:quit:": ["⇧⌘Q"],
};
type CatalogSpec = { title?: string; variants?: Readonly<Record<string, { title?: string }>> };
export const commandSpec = (command: string): CatalogSpec | undefined => (COMMANDS as Readonly<Record<string, CatalogSpec>>)[command];
export const LINUX_STANDARD_ITEMS: Readonly<Record<string, { command: string; title: string; path: string }>> = {
  "std:quit:": { command: "quit", title: "Quit Ardia", path: "Ardia" },
};
const unshifted = (shortcut: Shortcut): Shortcut => {
  const key = SHIFTED_KEYS[shortcut.key];
  return key ? storedShortcut([key, ...shortcut.modifiers, "shift"]) : shortcut;
};
const adapt = (sources: ShortcutSource[]): ShortcutSource[] => {
  const unavailable = unavailableCommands(linuxCapabilities());
  return sources.filter((source) => !unavailable.has(source.id) && (source.id in LINUX_STANDARD_ITEMS || (!source.id.startsWith("std:") && (source.id.includes(":") || commandSpec(source.id)?.title)))).map((source) => ({
    ...source,
    keys: (linuxKeys[source.id]?.map(parseShortcut) ?? source.keys).map(unshifted),
  }));
};

export const staticShortcutSources = () => adapt(sharedStaticSources());
export const shortcutSources = (profiles: readonly string[], overriddenIds: readonly string[]) => adapt(sharedSources(profiles, overriddenIds));
