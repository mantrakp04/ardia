import { startVaultMenus } from "./menu";
import { startVaultIndex } from "./store";

export function startVaults() {
  startVaultIndex();
  startVaultMenus();
}
