import { onVaultTouchID } from "../../platform/vaults";
import { activateVaultRow } from "./fill";
import { rowsOfMenu, vaultMenuOf } from "./menu";

let armed: { tabId: string; rowKey: string } | null = null;

export function armVaultTouchID(tabId: string, rowKey: string | null) {
  if (rowKey) armed = { tabId, rowKey };
  else if (armed?.tabId === tabId) armed = null;
}

export function fillArmedRow() {
  if (!armed) return false;
  const menu = vaultMenuOf(armed.tabId);
  const row = menu && rowsOfMenu(menu).find((r) => r.key === armed!.rowKey);
  if (!row) return false;
  activateVaultRow(armed.tabId, row);
  return true;
}

export const startVaultTouchID = () => onVaultTouchID(() => void fillArmedRow());
