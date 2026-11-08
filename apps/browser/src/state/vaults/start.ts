import { startVaultMenus } from "./menu";
import { startVaultIndex } from "./store";
import { startVaultTouchID } from "./touchID";

export function startVaults() {
  startVaultIndex();
  startVaultMenus();
  startVaultTouchID();
}
