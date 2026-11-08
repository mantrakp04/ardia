import { copyFromVault, type VaultFillField, type VaultItem } from "../../platform/vaults";
import { webviews } from "../../platform/webviews";
import { showToast } from "../app/toasts";
import { useBrowser } from "../browser/store";
import { unlockProvider, openPasswordSettings } from "./actions";
import { brandOf } from "./brands";
import { AFTER_FILL_QUIET_MS, closeVaultMenu, restingRow, patchVaultMenu, quietVaultField, rowsOfMenu, showAllPasswords, showVaultMatches, vaultMenuOf, otpFieldSeenSince, type VaultMenu } from "./menu";
import { itemKey, menuKey, type VaultRow } from "./menuModel";
import { OTP_FIELD_WAIT_MS, rememberPending } from "./pendingTotp";
import { currentPendingTotp, loadVaultItems, setPendingTotp, vaultProviderOf } from "./store";
import type { VaultFillError, VaultKeyEvent } from "./types";

const managerName = (provider: string) => vaultProviderOf(provider)?.name ?? brandOf(provider).name;

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

const windowOf = (tabId: string) => useBrowser.getState().tabs[tabId]?.windowId;

function copyCodeIfNoField(tabId: string, origin: string, item: VaultItem, filledAt: number) {
  setTimeout(() => {
    if (otpFieldSeenSince(origin, filledAt)) return;
    void copyFromVault(item.provider, item.id, "totp").then(
      ({ copied }) => {
        const windowId = windowOf(tabId);
        if (copied && windowId) showToast(windowId, "Copied One-Time Code", undefined, { icon: "number.circle", key: "vaultCode" });
      },
      () => {},
    );
  }, OTP_FIELD_WAIT_MS);
}

function afterLoginFill(tabId: string, origin: string, item: VaultItem) {
  if (item.hasTotp === false) return;
  const at = Date.now();
  setPendingTotp(rememberPending(currentPendingTotp(), { origin, provider: item.provider, id: item.id, at }));
  copyCodeIfNoField(tabId, origin, item, at);
}

async function fillItem(tabId: string, menu: VaultMenu, item: VaultItem, userChose: boolean) {
  const web = webviews.get(tabId);
  const fields: VaultFillField[] = menu.field === "otp" ? ["totp"] : ["username", "password"];
  patchVaultMenu(tabId, { busy: `login:${itemKey(item)}`, error: null }, menu.seq);
  const result = web
    ? await web.fillFromVault({ frameId: menu.frameId, origin: menu.origin, provider: item.provider, id: item.id, fields, userChose }).catch(() => ({ filled: [], error: "failed" as const }))
    : { filled: [], error: "failed" as const };
  if (vaultMenuOf(tabId)?.seq !== menu.seq) return;
  if (result.error === "notAuthorized") return patchVaultMenu(tabId, { busy: null, error: null }, menu.seq);
  if (result.error) {
    if (result.error === "locked" || result.error === "notFound") void loadVaultItems(item.provider, true);
    return patchVaultMenu(tabId, { busy: null, error: fillErrorText(result.error, item.provider) }, menu.seq);
  }
  quietVaultField(tabId, menu, AFTER_FILL_QUIET_MS);
  closeVaultMenu(tabId, true);
  if (menu.field !== "otp") afterLoginFill(tabId, menu.origin, item);
}

async function fillGenerated(tabId: string, menu: VaultMenu) {
  const web = webviews.get(tabId);
  patchVaultMenu(tabId, { busy: "generate", error: null }, menu.seq);
  const result = web ? await web.fillGeneratedPassword({ frameId: menu.frameId, origin: menu.origin }).catch(() => null) : null;
  if (vaultMenuOf(tabId)?.seq !== menu.seq) return;
  if (!result?.filled.length) return patchVaultMenu(tabId, { busy: null, error: "Couldn't fill a password here. Try again." }, menu.seq);
  quietVaultField(tabId, menu, AFTER_FILL_QUIET_MS);
  closeVaultMenu(tabId, true);
}

async function unlockFromMenu(tabId: string, menu: VaultMenu, provider: string) {
  patchVaultMenu(tabId, { busy: `unlock:${provider}`, error: null }, menu.seq);
  const result = await unlockProvider(provider, null);
  if (vaultMenuOf(tabId)?.seq !== menu.seq) return;
  if (result.ok) {
    await loadVaultItems(provider, true);
    const now = vaultMenuOf(tabId);
    return patchVaultMenu(tabId, { busy: null, selected: now ? restingRow(rowsOfMenu(now)) : -1 }, menu.seq);
  }
  if (result.needs === "password") {
    closeVaultMenu(tabId);
    return openPasswordSettings();
  }
  patchVaultMenu(tabId, { busy: null, error: `Couldn't unlock ${managerName(provider)}. Try again.` }, menu.seq);
}

export function activateVaultRow(tabId: string, row: VaultRow) {
  const menu = vaultMenuOf(tabId);
  if (!menu || menu.busy) return;
  switch (row.kind) {
    case "login":
      return void fillItem(tabId, menu, row.item, row.userChose || menu.mode === "search");
    case "otp":
      return void fillItem(tabId, menu, row.item, false);
    case "generate":
    case "suggest":
      return void fillGenerated(tabId, menu);
    case "unlock":
      return void unlockFromMenu(tabId, menu, row.provider);
    case "allPasswords":
      return showAllPasswords(tabId);
    case "settings":
      closeVaultMenu(tabId);
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
    if (key === "Escape") quietVaultField(tabId, menu, null);
    return closeVaultMenu(tabId, menu.mode === "search");
  }
  if (action === "move") return patchVaultMenu(tabId, { selected, error: null });
  if (action === "activate") activateVaultRow(tabId, rows[selected]!);
}

export function noteVaultKey(tabId: string, event: VaultKeyEvent) {
  const menu = vaultMenuOf(tabId);
  if (menu && menu.frameId === event.frameId && menu.mode !== "search") stepVaultMenu(tabId, event.key);
}

export const noteCodeUnavailable = (tabId: string, seq: number, key: string) => {
  const menu = vaultMenuOf(tabId);
  if (menu?.seq === seq && !menu.noTotp.includes(key)) patchVaultMenu(tabId, { noTotp: [...menu.noTotp, key] }, seq);
};
