import type { CommandAction } from "@ardia/core";
import { copyFromVault, type VaultCopyField } from "../../platform/vaults";
import { showToast } from "../app/toasts";
import type { BrowserState } from "../browser/store";
import { activeTab } from "../browser/model";
import { lockAllProviders } from "./actions";
import { openVaultMenuOnDemand } from "./menu";
import { bestItem, isSecureOrigin, siteLabel } from "./originMatch";
import { allVaultItems, anyVaultConnected, currentVaultProviders } from "./store";

const ACTIONS = {
  "vault:fill": { title: "Fill Password", icon: "key.fill", keywords: ["autofill", "password manager", "login", "sign in"] },
  "vault:copyPassword": { title: "Copy Password", icon: "key", keywords: ["password manager", "copy login"] },
  "vault:copyUsername": { title: "Copy Username", icon: "person.crop.circle", keywords: ["password manager", "copy email", "copy login"] },
  "vault:copyCode": { title: "Copy One-Time Code", icon: "number.circle", keywords: ["totp", "2fa", "two factor", "verification code", "otp"] },
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
  const best = origin ? bestItem(allVaultItems(), origin) : null;
  if (origin) ids.push("vault:fill");
  if (best) ids.push("vault:copyPassword", "vault:copyUsername");
  if (best && best.hasTotp !== false) ids.push("vault:copyCode");
  if (currentVaultProviders().some((p) => p.state === "unlocked")) ids.push("vault:lock");
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

const COPIED: Record<VaultCopyField, string> = { password: "Copied Password", username: "Copied Username", totp: "Copied One-Time Code" };
const COPY_FIELD: Partial<Record<VaultActionId, VaultCopyField>> = { "vault:copyPassword": "password", "vault:copyUsername": "username", "vault:copyCode": "totp" };

async function copyBest(windowId: string, origin: string, field: VaultCopyField) {
  const item = bestItem(allVaultItems(), origin);
  if (!item) return;
  const done = await copyFromVault(item.provider, item.id, field).catch(() => null);
  if (done?.copied) showToast(windowId, COPIED[field], undefined, { icon: "doc.on.doc", key: "vaultCopy" });
  else showToast(windowId, field === "totp" ? "This login has no one-time code" : "Couldn't copy from your password manager", undefined, { icon: "exclamationmark.circle", key: "vaultCopy" });
}

export function runVaultAction(id: VaultActionId, s: BrowserState, windowId: string) {
  const tab = activeTab(s, windowId);
  const origin = pageOrigin(tab?.url);
  if (id === "vault:lock") return void lockAllProviders();
  if (!tab || !origin) return;
  const field = COPY_FIELD[id];
  if (field) return void copyBest(windowId, origin, field);
  if (!openVaultMenuOnDemand(tab.id)) showToast(windowId, "No login field selected. Click one and try again.", undefined, { icon: "key", key: "vaultCopy" });
}
