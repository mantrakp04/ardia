import type { BrowserCommand } from "../../platform/commands";
import type { Settings } from "../settings/settings";

export const BOOKMARK_COMMANDS: readonly BrowserCommand[] = [
  "bookmarkPage",
  "addBookmarkToFolder",
  "openBookmark",
  "manageBookmarks",
  "exportBookmarks",
  "bookmarkAllTabs",
  "setBookmarksBar",
  "toggleBookmarksBar",
  "addFolderToSidebar",
  "restoreArcFolders",
];

const BOOKMARK_COMMAND_SET: ReadonlySet<string> = new Set(BOOKMARK_COMMANDS);

export const bookmarksShown = (settings: Pick<Settings, "showBookmarks">) => settings.showBookmarks;

export const hidesBookmarkCommand = (settings: Pick<Settings, "showBookmarks">, command: string) =>
  !settings.showBookmarks && BOOKMARK_COMMAND_SET.has(command);
