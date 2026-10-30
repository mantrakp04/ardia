import { useRef } from "react";
import { Symbol, closeWindow, emitCommand } from "@ardia/shell";
import { useBrowser } from "../../browser/src/state/browser/store";
import { menuState } from "../../browser/src/state/commands/menuState";
import { useTheme } from "../../browser/src/components/ui/theme";
import { menuShown, showMenu } from "./menus";
import { linuxMenuShortcuts } from "./shortcuts";
import { appMenuChoice, appMenuItems } from "./appMenu";
import { hostModuleMethod, reportHostError } from "./host";

export async function openAppMenu(windowId: string, button: HTMLElement) {
  const state = useBrowser.getState();
  const shortcuts = new Map(linuxMenuShortcuts(state.settings.shortcuts, state.profileOrder).map((shortcut) => [
    shortcut.id,
    "key" in shortcut ? { key: shortcut.key, modifiers: shortcut.modifiers } : { key: "", modifiers: [] },
  ]));
  const focusOrder = [windowId, ...state.ui.focusOrder.filter((id) => id !== windowId)];
  const items = appMenuItems(menuState({ ...state, ui: { ...state.ui, focusOrder } }), shortcuts);
  const { left, bottom } = button.getBoundingClientRect();
  const id = await showMenu(items, { x: left, y: bottom + 4 });
  const choice = id ? appMenuChoice(id) : null;
  if (!choice) return;
  if (choice.kind === "command") return emitCommand({ command: choice.command, arg: choice.arg, windowId });
  if (choice.action === "close") return void closeWindow(windowId).catch(reportHostError);
  void hostModuleMethod("ArdiaShell", choice.action === "minimize" ? "minimizeWindow" : "toggleMaximizeWindow")(windowId).catch(reportHostError);
}

export function AppMenuButton({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const closingOpenMenu = useRef(false);
  return (
    <button
      className="ardia-header-button ardia-app-menu-button"
      data-ardia-app-menu
      aria-label="Menu"
      aria-haspopup="menu"
      title="Menu"
      onPointerDown={() => { closingOpenMenu.current = menuShown(); }}
      onClick={(event) => {
        if (closingOpenMenu.current) return void (closingOpenMenu.current = false);
        void openAppMenu(windowId, event.currentTarget).catch(reportHostError);
      }}
    >
      <Symbol name="line.3.horizontal" size={15} color={theme.icon} style={{ width: 18, height: 18 }} />
    </button>
  );
}
