import { showMenu as showNativeMenu, type MenuItem } from "@ardia/shell";
import { withIconNames } from "../lib/activeLook";

export { menuShown, watchMenus, type MenuItem, type MenuEntry } from "@ardia/shell";

export const showMenu = (items: MenuItem[]): Promise<string | null> => showNativeMenu(withIconNames(items));
