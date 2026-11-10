import type { VaultTouchIDStatus } from "../../platform/vaults";
import { activateVaultRow, BY_TOUCH_ID } from "./fill";
import { patchVaultMenu, rowsOfMenu, vaultMenuOf, type VaultMenu, type VaultTouchPhase } from "./menu";
import type { VaultRow } from "./menuModel";
import { vaultProviderOf } from "./store";

let armed: { tabId: string; seq: number } | null = null;

export function armVaultTouchID(tabId: string, menuSeq: number | null) {
  if (menuSeq !== null) armed = { tabId, seq: menuSeq };
  else if (armed?.tabId === tabId) armed = null;
}

export const touchIDGlyphShown = (phase: VaultTouchPhase) => phase !== "unavailable" && phase !== "lockout";

export function isTouchRow(row: VaultRow | undefined): boolean {
  if (row?.kind === "login" || row?.kind === "otp") return true;
  return row?.kind === "unlock" && !!vaultProviderOf(row.provider)?.touchUnlock;
}

export function touchRowOf(menu: VaultMenu): VaultRow | null {
  if (menu.hidden || menu.busy || !touchIDGlyphShown(menu.touch)) return null;
  const row = rowsOfMenu(menu)[menu.selected];
  return row && isTouchRow(row) ? row : null;
}

export function grantVaultTouch(tabId: string, menuSeq: number): boolean {
  const menu = vaultMenuOf(tabId);
  if (!armed || armed.tabId !== tabId || armed.seq !== menuSeq || !menu || menu.seq !== menuSeq || menu.busy) return false;
  const row = touchRowOf(menu);
  if (!row) {
    patchVaultMenu(tabId, { touch: "off", touchRearms: menu.touchRearms + 1 }, menuSeq);
    return false;
  }
  patchVaultMenu(tabId, { touch: "granted" }, menuSeq);
  activateVaultRow(tabId, row, BY_TOUCH_ID);
  return true;
}

export function noteVaultTouchStatus(tabId: string, menuSeq: number, status: VaultTouchIDStatus) {
  const menu = vaultMenuOf(tabId);
  if (!menu || menu.seq !== menuSeq) return;
  switch (status) {
    case "ready":
      if (menu.touch === "granted" && menu.busy) return;
      return patchVaultMenu(tabId, { touch: "ready" }, menuSeq);
    case "retry":
      return patchVaultMenu(tabId, { touch: "retry", touchRetries: menu.touchRetries + 1 }, menuSeq);
    case "granted":
      return void grantVaultTouch(tabId, menuSeq);
    case "unavailable":
    case "lockout":
      return patchVaultMenu(tabId, { touch: status }, menuSeq);
  }
}
