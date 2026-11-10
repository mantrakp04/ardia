import { startVaultContextMenu } from "./contextFill";
import { startGeneratedPasswords } from "./generated";
import { startVaultMenus } from "./menu";
import { startVaultIndex } from "./store";

export function startVaults() {
  startVaultIndex();
  startVaultMenus();
  startGeneratedPasswords();
  startVaultContextMenu();
}
