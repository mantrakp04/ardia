import { showMenu, type MenuItem } from "../../platform/menus";
import { COMMANDS } from "../commands/commandCatalog";
import { menuShortcut } from "../commands/commandShortcuts";
import { runCommand } from "../commands/commands";
import { checkForUpdates } from "./appSettings";
import { menuSections } from "./menuSections";

type Listed = "newTab" | "newWindow" | "newIncognitoWindow" | "showHistory" | "downloads" | "findInPage" | "print" | "openSettings" | "keyboardShortcuts" | "reportProblem" | "releaseNotes";

const CHECK_FOR_UPDATES = "checkForUpdates";

const listed = (command: Listed): MenuItem => ({ id: command, title: COMMANDS[command].title, ...menuShortcut(command) });

export const appMenuItems = (): MenuItem[] =>
  menuSections(
    [listed("newTab"), listed("newWindow"), listed("newIncognitoWindow")],
    [listed("showHistory"), listed("downloads")],
    [listed("findInPage"), listed("print")],
    [listed("openSettings"), listed("keyboardShortcuts"), { id: CHECK_FOR_UPDATES, title: "Check for Updates…" }],
    [listed("releaseNotes"), listed("reportProblem")],
  );

export async function showAppMenu(windowId: string) {
  const choice = await showMenu(appMenuItems());
  if (!choice) return;
  if (choice === CHECK_FOR_UPDATES) return void checkForUpdates();
  runCommand({ command: choice as Listed, arg: null, windowId });
}
