import { nativeModule, type CommandEvent, type MenuState } from "@ardia/shell";

export type { CommandEvent, BrowserCommand, MenuShortcut, ShortcutModifier, MenuState, MenuBookmark } from "@ardia/shell";

const Menus = nativeModule("ArdiaMenus");

export const onCommand = (listener: (e: CommandEvent) => void) => Menus.addListener("onCommand", listener);
export const menuShortcuts = () => Menus.menuShortcuts();
export const recordShortcut = () => Menus.recordShortcut();
export const cancelShortcutRecording = () => Menus.cancelRecording();

export function setMenuStateParts(state: MenuState, bookmarksChanged: boolean) {
  const { bookmarkFolders, recentBookmarks, bookmarksBar, otherBookmarks, ...rest } = state;
  if (bookmarksChanged) void Menus.setMenuBookmarks({ bookmarkFolders, recentBookmarks, bookmarksBar, otherBookmarks });
  return Menus.setMenuState(rest);
}
