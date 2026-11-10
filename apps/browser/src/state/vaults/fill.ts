import type { VaultFillField, VaultItem, VaultPasswordStyle } from "../../platform/vaults";
import { webviews } from "../../platform/webviews";
import { unlockProvider, openPasswordSettings } from "./actions";
import { noteFilledUsername, rememberVaultAccount } from "./accounts";
import { brandOf } from "./brands";
import { contextPickOf, contextTargetOf } from "./contextTarget";
import { prefetchVaultCode } from "./codes";
import {
  AFTER_FILL_QUIET_MS,
  dismissVaultMenu,
  noteGeneratedFill,
  noteVaultFieldCleared,
  patchVaultMenu,
  quietVaultField,
  reopenVaultMenuFromKey,
  resyncVaultPage,
  restingRowOf,
  setVaultSuggestOpen,
  rowsOfMenu,
  showAllPasswords,
  showVaultMatches,
  vaultMenuOf,
  type VaultMenu,
} from "./menu";
import { menuKey, type VaultRow } from "./menuModel";
import { rememberPending } from "./pendingTotp";
import { currentPendingTotp, loadVaultItems, setPendingTotp, vaultProviderOf } from "./store";
import type { VaultFillError, VaultKeyEvent } from "./types";

const managerName = (provider: string) => vaultProviderOf(provider)?.name ?? brandOf(provider).name;

export const TOUCH_ID_EXPIRED = "Touch ID timed out. Try again.";

export function fillErrorText(error: VaultFillError | string, provider: string): string {
  switch (error) {
    case "locked":
      return `${managerName(provider)} is locked. Unlock it to fill.`;
    case "originMismatch":
      return "This login is saved for another site.";
    case "insecure":
      return "This page isn't secure, so nothing was filled.";
    case "notFound":
      return `This login is no longer in ${managerName(provider)}.`;
    default:
      return "Couldn't fill this login. Try again.";
  }
}

export type VaultFillHow = { submit: boolean; touchID: boolean };
export const BY_HAND: VaultFillHow = { submit: false, touchID: false };
export const BY_TOUCH_ID: VaultFillHow = { submit: true, touchID: true };

function rememberCode(origin: string, item: VaultItem) {
  if (item.hasTotp === false) return;
  setPendingTotp(rememberPending(currentPendingTotp(), { origin, provider: item.provider, id: item.id, at: Date.now() }));
  if (item.hasTotp === true) prefetchVaultCode(item);
}

export const NOTHING_FILLED = "Couldn't find the field to fill. Click it and try again.";
export const NO_CODE = "This login has no one-time code.";

function finishFill(tabId: string, menu: VaultMenu) {
  quietVaultField(tabId, menu, AFTER_FILL_QUIET_MS);
  dismissVaultMenu(tabId, true);
}

async function fillItem(tabId: string, menu: VaultMenu, row: VaultRow, item: VaultItem, userChose: boolean, how: VaultFillHow) {
  const web = webviews.get(tabId);
  const fields: VaultFillField[] = menu.field === "otp" ? ["totp"] : ["username", "password"];
  patchVaultMenu(tabId, { busy: row.key, error: null }, menu.seq);
  const request = { frameId: menu.frameId, origin: menu.origin, provider: item.provider, id: item.id, fields, userChose, submit: how.submit, ...contextPickOf(tabId, menu.seq) };
  const result = web ? await web.fillFromVault(request).catch(() => ({ filled: [], error: "failed" as const })) : { filled: [], error: "failed" as const };
  if (vaultMenuOf(tabId)?.seq !== menu.seq) return;
  if (result.error === "notAuthorized") {
    return patchVaultMenu(tabId, { busy: null, error: how.touchID ? TOUCH_ID_EXPIRED : null, touch: "off" }, menu.seq);
  }
  if (result.error) {
    if (result.error === "locked" || result.error === "notFound") void loadVaultItems(item.provider, true);
    const text = result.error === "notFound" && menu.field === "otp" ? NO_CODE : fillErrorText(result.error, item.provider);
    return patchVaultMenu(tabId, { busy: null, error: text, touch: "off" }, menu.seq);
  }
  if (!result.filled.length) return patchVaultMenu(tabId, { busy: null, error: NOTHING_FILLED, touch: "off" }, menu.seq);
  rememberVaultAccount(menu.origin, item);
  if (menu.field !== "otp") noteFilledUsername(tabId, menu.origin, item.username);
  finishFill(tabId, menu);
  if (menu.field !== "otp") rememberCode(menu.origin, item);
}

async function fillUsername(tabId: string, menu: VaultMenu, row: VaultRow, item: VaultItem) {
  const web = webviews.get(tabId);
  patchVaultMenu(tabId, { busy: row.key, error: null }, menu.seq);
  const request = { frameId: menu.frameId, origin: menu.origin, provider: item.provider, id: item.id, fields: ["username" as const], userChose: true, submit: false, ...contextTargetOf(tabId, menu.seq) };
  const result = web ? await web.fillFromVault(request).catch(() => null) : null;
  if (vaultMenuOf(tabId)?.seq !== menu.seq) return;
  if (!result?.filled.includes("username")) return patchVaultMenu(tabId, { busy: null, error: NOTHING_FILLED, touch: "off" }, menu.seq);
  noteFilledUsername(tabId, menu.origin, item.username);
  finishFill(tabId, menu);
}

async function fillGenerated(tabId: string, menu: VaultMenu, row: VaultRow, style: VaultPasswordStyle) {
  const web = webviews.get(tabId);
  patchVaultMenu(tabId, { busy: row.key, error: null }, menu.seq);
  const request = { frameId: menu.frameId, origin: menu.origin, style, ...(menu.maxLength > 0 ? { maxLength: menu.maxLength } : {}), ...contextTargetOf(tabId, menu.seq) };
  const result = web ? await web.fillGeneratedPassword(request).catch(() => null) : null;
  if (vaultMenuOf(tabId)?.seq !== menu.seq) return;
  if (!result?.filled.length) return patchVaultMenu(tabId, { busy: null, error: "Couldn't fill a password here. Try again." }, menu.seq);
  noteGeneratedFill(tabId, menu.frameId, menu.origin, menu.field);
  finishFill(tabId, menu);
}

async function unlockFromMenu(tabId: string, menu: VaultMenu, row: VaultRow, provider: string, how: VaultFillHow) {
  patchVaultMenu(tabId, { busy: row.key, error: null }, menu.seq);
  const result = await unlockProvider(provider, null);
  if (vaultMenuOf(tabId)?.seq !== menu.seq) return;
  if (result.ok) {
    await loadVaultItems(provider, true);
    const now = vaultMenuOf(tabId);
    const selected = now ? restingRowOf(now) : -1;
    patchVaultMenu(tabId, { busy: null, touch: how.touchID ? "granted" : "off", selected }, menu.seq);
    const next = now && selected >= 0 ? rowsOfMenu(vaultMenuOf(tabId) ?? now)[selected] : undefined;
    if (next && (next.kind === "login" || next.kind === "otp")) activateVaultRow(tabId, next, how);
    else if (how.touchID) patchVaultMenu(tabId, { touch: "off" }, menu.seq);
    return;
  }
  if (result.needs === "password") {
    dismissVaultMenu(tabId);
    return openPasswordSettings();
  }
  patchVaultMenu(tabId, { busy: null, touch: "off", error: `Couldn't unlock ${managerName(provider)}. Try again.` }, menu.seq);
}

export function activateVaultRow(tabId: string, row: VaultRow, how: VaultFillHow = BY_HAND) {
  const menu = vaultMenuOf(tabId);
  if (!menu || menu.busy) return;
  switch (row.kind) {
    case "login":
      return void fillItem(tabId, menu, row, row.item, row.userChose || menu.mode === "search", how);
    case "otp":
      return void fillItem(tabId, menu, row, row.item, row.userChose, how);
    case "username":
      return void fillUsername(tabId, menu, row, row.item);
    case "generate":
      return void fillGenerated(tabId, menu, row, row.style);
    case "suggest":
      return setVaultSuggestOpen(tabId, true);
    case "unlock":
      return void unlockFromMenu(tabId, menu, row, row.provider, how);
    case "allPasswords":
      return showAllPasswords(tabId);
    case "openPasswords":
    case "settings":
      dismissVaultMenu(tabId);
      return openPasswordSettings();
  }
}

export function stepVaultMenu(tabId: string, key: string) {
  const menu = vaultMenuOf(tabId);
  if (!menu) return;
  const rows = rowsOfMenu(menu);
  const { selected, action } = menuKey(menu.selected, rows.length, key);
  if (action === "close") {
    if (menu.mode === "search" && key === "Escape") return showVaultMatches(tabId);
    if (menu.suggestOpen && key === "Escape") return setVaultSuggestOpen(tabId, false);
    if (key === "Escape") quietVaultField(tabId, menu, null);
    return dismissVaultMenu(tabId, menu.mode === "search");
  }
  if (action === "move") return patchVaultMenu(tabId, { selected, error: null });
  if (action === "activate") activateVaultRow(tabId, rows[selected]!);
}

export function noteVaultKey(tabId: string, event: VaultKeyEvent) {
  const menu = vaultMenuOf(tabId);
  const ours = !!menu && menu.frameId === event.frameId;
  if (event.key === "Typed") return void (ours && menu.mode !== "search" && dismissVaultMenu(tabId));
  if (event.key === "Cleared") return noteVaultFieldCleared(tabId, event.frameId);
  if (!ours) {
    if (event.key === "ArrowDown") reopenVaultMenuFromKey(tabId, event.frameId);
    else resyncVaultPage(tabId, event.frameId);
    return;
  }
  if (menu.hidden || menu.mode === "search") return;
  stepVaultMenu(tabId, event.key);
}

export const noteCodeUnavailable = (tabId: string, seq: number, key: string) => {
  const menu = vaultMenuOf(tabId);
  if (menu?.seq === seq && !menu.noTotp.includes(key)) patchVaultMenu(tabId, { noTotp: [...menu.noTotp, key] }, seq);
};
