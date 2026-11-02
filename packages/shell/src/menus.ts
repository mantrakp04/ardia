import type { EventSubscription } from "expo-modules-core";
import type { CommandEvent } from "./commands";
import { nativeModule } from "./nativeModules";
import type { MenuShortcut, ShortcutModifier } from "./system";

export type MenuItem =
  | { separator: true }
  | {
      id: string;
      title: string;
      symbol?: string;
      swatch?: string;
      swatchDark?: string;
      key?: string;
      modifiers?: ("command" | "shift" | "option" | "control")[];
      enabled?: boolean;
      checked?: boolean;
      alternate?: boolean;
      children?: MenuItem[];
      share?: boolean;
    };

export type MenuEntry = { id: string; title: string; current?: boolean };
export type MenuBookmark = { id: string; title: string; url?: string; children?: MenuBookmark[] };

export type MenuState = {
  checked: string[];
  disabled: string[];
  titles: Record<string, string>;
  profiles: MenuEntry[];
  windows: MenuEntry[];
  bookmarkFolders: MenuEntry[];
  recentBookmarks: MenuBookmark[];
  bookmarksBar: MenuBookmark[];
  otherBookmarks: MenuBookmark[];
  recentlyClosed: MenuEntry[];
  recentlyClosedGroups?: MenuEntry[];
  warnBeforeQuitting: boolean;
  warnBeforeClosingWindow?: boolean;
  undoReopensClosedTab?: boolean;
  downloadsInProgress?: number;
  extensions?: { id: string; title: string; icon?: string | null; enabled: boolean }[];
  shortcuts?: Record<string, string[][]>;
};

export type MenuBookmarkKey = "bookmarkFolders" | "recentBookmarks" | "bookmarksBar" | "otherBookmarks";

export type MenusNative = {
  addListener(name: "onCommand", listener: (e: CommandEvent) => void): EventSubscription;
  showMenu(items: MenuItem[]): Promise<string | null>;
  setMenuState(state: Omit<MenuState, MenuBookmarkKey>): Promise<void>;
  setMenuBookmarks(bookmarks: Pick<MenuState, MenuBookmarkKey>): Promise<void>;
  menuShortcuts(): Promise<MenuShortcut[]>;
  recordShortcut(): Promise<{ key: string; modifiers: ShortcutModifier[] } | null>;
  cancelRecording(): Promise<void>;
};

let menusShown = 0;
const menuWatchers = new Set<() => void>();
const menusChanged = (by: number) => {
  menusShown += by;
  for (const watcher of menuWatchers) watcher();
};
export const menuShown = () => menusShown > 0;
export function watchMenus(watcher: () => void): () => void {
  menuWatchers.add(watcher);
  return () => void menuWatchers.delete(watcher);
}

export function showMenu(items: MenuItem[]): Promise<string | null> {
  menusChanged(1);
  return Promise.resolve(nativeModule("ArdiaMenus").showMenu(items)).finally(() => menusChanged(-1));
}
