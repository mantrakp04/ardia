import { fileURLToPath } from "node:url";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
export const inputAdapters = new Map([
  [here("../browser/src/state/commands/commandShortcuts.ts"), here("./src/shortcutState.ts")],
  [here("../browser/src/state/commands/commandCatalog.ts"), here("./src/commandCatalog.ts")],
  [here("../browser/src/state/commands/shortcuts.ts"), here("./src/shortcutFormat.ts")],
  [here("../browser/src/platform/commands.ts"), here("./src/shortcutCommands.ts")],
  [here("../browser/src/lib/keys.ts"), here("./src/clickModifiers.ts")],
]);

export const rawBookmarkAdapter = {
  source: here("../browser/src/state/bookmarks/actions.ts"),
  replacement: here("./src/rawBookmarkActions.ts"),
  importers: new Set([
    here("../browser/src/components/bookmarks/BarItem.tsx"),
    here("../browser/src/components/pages/HistoryRow.tsx"),
  ]),
};

export const resolveInputAdapter = (source: string, importer: string) =>
  source === rawBookmarkAdapter.source && rawBookmarkAdapter.importers.has(importer) ? rawBookmarkAdapter.replacement : inputAdapters.get(source);
