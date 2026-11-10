import type { CommandAction } from "@ardia/core";
import type { VaultCopyField } from "../../platform/vaults";
import { showToast } from "../app/toasts";
import type { BrowserState } from "../browser/store";
import { activeTab } from "../browser/model";
import { filledUsername, rememberedVaultAccount } from "./accounts";
import { copyFailureMessage, copyFromManager, lockAllProviders } from "./actions";
import { itemsForTab, passwordManagersOnly } from "./ardia";
import { openVaultMenuOnDemand } from "./menu";
import { bestItem, isSecureOrigin, rankItems, sameUsername, siteLabel, TIER } from "./originMatch";
import { allVaultItems, anyVaultConnected, currentVaultProviders } from "./store";
import type { VaultItem } from "./types";

const ACTIONS = {
  "vault:fill": { title: "Fill Password", icon: "key.fill", keywords: ["autofill", "password manager", "login", "sign in"] },
  "vault:copyPassword": { title: "Copy Password", icon: "key", keywords: ["password manager", "copy login"] },
  "vault:copyUsername": { title: "Copy Username", icon: "person.crop.circle", keywords: ["password manager", "copy email", "copy login"] },
  "vault:lock": { title: "Lock Password Managers", icon: "lock", keywords: ["lock vault", "1password", "bitwarden", "proton pass"] },
} as const;

export type VaultActionId = keyof typeof ACTIONS;

export const isVaultActionId = (id: string): id is VaultActionId => id in ACTIONS;

const pageOrigin = (url: string | undefined) => {
  const m = /^(https?:\/\/[^/?#]+)/i.exec(url ?? "");
  return m && isSecureOrigin(m[1]!) ? m[1]! : null;
};

function shownIds(s: BrowserState, windowId: string): VaultActionId[] {
  if (!anyVaultConnected()) return [];
  const ids: VaultActionId[] = [];
  const origin = pageOrigin(activeTab(s, windowId)?.url);
  const tab = activeTab(s, windowId);
  const best = origin && tab ? bestItem(itemsForTab(allVaultItems(), tab.id), origin) : null;
  if (origin) ids.push("vault:fill");
  if (best) ids.push("vault:copyPassword", "vault:copyUsername");
  if (passwordManagersOnly(currentVaultProviders()).some((p) => p.state === "unlocked")) ids.push("vault:lock");
  return ids;
}

export function vaultBarActions(s: BrowserState, windowId: string): CommandAction[] {
  const site = pageOrigin(activeTab(s, windowId)?.url);
  return shownIds(s, windowId).map((id) => ({
    id,
    title: ACTIONS[id].title,
    icon: ACTIONS[id].icon,
    keywords: site && id !== "vault:lock" ? [...ACTIONS[id].keywords, siteLabel(site)] : [...ACTIONS[id].keywords],
  }));
}

const COPIED: Record<VaultCopyField, string> = { password: "Copied Password", username: "Copied Username" };
const COPY_FIELD: Partial<Record<VaultActionId, VaultCopyField>> = { "vault:copyPassword": "password", "vault:copyUsername": "username" };

export function copyChoice(items: readonly VaultItem[], origin: string, filled = "", remembered: string | null = null): VaultItem | null {
  const matches = rankItems(items, origin, remembered).filter((r) => r.tier >= TIER.subdomain).map((r) => r.item);
  return (filled && matches.find((item) => sameUsername(item.username, filled))) || matches[0] || null;
}

async function copyBest(windowId: string, tabId: string, origin: string, field: VaultCopyField) {
  const item = copyChoice(itemsForTab(allVaultItems(), tabId), origin, filledUsername(tabId, origin), rememberedVaultAccount(origin));
  if (!item) return;
  const outcome = await copyFromManager(item.provider, item.id, field);
  if (outcome === "copied") return showToast(windowId, COPIED[field], undefined, { icon: "doc.on.doc", key: "vaultCopy" });
  const problem = copyFailureMessage(outcome, field, item.provider);
  if (problem) showToast(windowId, problem, undefined, { icon: "exclamationmark.circle", key: "vaultCopy" });
}

export function runVaultAction(id: VaultActionId, s: BrowserState, windowId: string) {
  const tab = activeTab(s, windowId);
  const origin = pageOrigin(tab?.url);
  if (id === "vault:lock") return void lockAllProviders();
  if (!tab || !origin) return;
  const field = COPY_FIELD[id];
  if (field) return void copyBest(windowId, tab.id, origin, field);
  if (!openVaultMenuOnDemand(tab.id)) showToast(windowId, "No login field selected. Click one and try again.", undefined, { icon: "key", key: "vaultCopy" });
}
