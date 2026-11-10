import { create } from "zustand";
import {
  copyGeneratedPassword,
  deleteGeneratedPassword,
  listGeneratedPasswords,
  onGeneratedPasswordsChanged,
  saveGeneratedPassword,
  type VaultGeneratedPassword,
  type VaultGeneratedSaveResult,
  type VaultItem,
  type VaultProviderState,
} from "../../platform/vaults";
import { useBrowser } from "../browser/store";
import { VAULT_KEEP_GENERATED_DAYS } from "../settings/settings";
import { copyOutcomeOf, type VaultCopyOutcome } from "./actions";
import { rememberVaultAccount } from "./accounts";
import { searchItems, siteLabel } from "./originMatch";
import { saveTargets } from "./saveOffer";
import { loadVaultItems } from "./store";

export type { VaultGeneratedPassword };
export type KeepGeneratedDays = (typeof VAULT_KEEP_GENERATED_DAYS)[number];

export const GENERATED_PROVIDER = "generated";
export const DAY_MS = 86_400_000;
export const KEEP_FOREVER = -1;
export const KEEP_NONE = 0;
export const NEEDS_USERNAME = "needsUsername";

const KEEP_TITLES: readonly (readonly [KeepGeneratedDays, string])[] = [
  [1, "1 Day"],
  [7, "7 Days"],
  [30, "30 Days"],
  [KEEP_FOREVER, "Until Deleted"],
  [KEEP_NONE, "Never"],
];

export const keepGeneratedTitle = (days: number) => KEEP_TITLES.find(([d]) => d === days)?.[1] ?? `${days} Days`;
export const KEEP_GENERATED_OPTIONS = VAULT_KEEP_GENERATED_DAYS.map((days) => ({ value: String(days), title: keepGeneratedTitle(days) }));

export function isGeneratedExpired(createdAt: number, keepDays: number, now: number): boolean {
  if (keepDays === KEEP_NONE) return true;
  if (keepDays < 0) return false;
  return now - createdAt >= keepDays * DAY_MS;
}

export const keptGenerated = (list: readonly VaultGeneratedPassword[], keepDays: number, now: number): VaultGeneratedPassword[] =>
  list.filter((e) => !isGeneratedExpired(e.createdAt, keepDays, now)).sort((a, b) => b.createdAt - a.createdAt);

export const generatedItem = (entry: VaultGeneratedPassword): VaultItem => ({
  provider: GENERATED_PROVIDER,
  id: entry.id,
  title: siteLabel(entry.origin),
  username: entry.username,
  urls: [entry.origin],
  hasTotp: false,
  updatedAt: entry.createdAt,
});

export const isGeneratedItem = (item: Pick<VaultItem, "provider">) => item.provider === GENERATED_PROVIDER;

export function searchGenerated(list: readonly VaultGeneratedPassword[], query: string, limit: number): VaultItem[] {
  const items = list.map(generatedItem);
  return query.trim() ? searchItems(items, query, limit) : items.slice(0, limit);
}

export const generatedSaveTargets = (providers: readonly VaultProviderState[]) => saveTargets(providers);

export const useGeneratedPasswords = create<{ list: VaultGeneratedPassword[]; loaded: boolean }>()(() => ({ list: [], loaded: false }));

const keepDaysNow = () => useBrowser.getState().settings.vaultKeepGenerated;

export const currentGeneratedPasswords = (now = Date.now()) => keptGenerated(useGeneratedPasswords.getState().list, keepDaysNow(), now);
export const generatedPasswordOf = (id: string) => useGeneratedPasswords.getState().list.find((e) => e.id === id) ?? null;

let loads = 0;

export async function loadGeneratedPasswords() {
  const mine = ++loads;
  const list = await listGeneratedPasswords().catch(() => null);
  if (mine !== loads) return;
  useGeneratedPasswords.setState((s) => ({ list: list ?? s.list, loaded: true }));
}

const forget = (id: string) => useGeneratedPasswords.setState((s) => ({ list: s.list.filter((e) => e.id !== id) }));

let started = false;

export function startGeneratedPasswords() {
  if (started) return;
  started = true;
  onGeneratedPasswordsChanged(() => void loadGeneratedPasswords());
  void loadGeneratedPasswords();
}

export async function copyGenerated(id: string): Promise<VaultCopyOutcome> {
  return copyOutcomeOf(await copyGeneratedPassword(id).catch(() => null));
}

export async function deleteGenerated(id: string): Promise<boolean> {
  const result = await deleteGeneratedPassword(id).catch(() => null);
  if (result?.deleted) forget(id);
  void loadGeneratedPasswords();
  return !!result?.deleted;
}

export async function saveGenerated(id: string, provider: string, username: string | null): Promise<VaultGeneratedSaveResult> {
  const entry = generatedPasswordOf(id);
  const typed = username?.trim() || null;
  if (!typed && !entry?.username.trim()) return { saved: false, error: NEEDS_USERNAME };
  const result = await saveGeneratedPassword(id, provider, typed).catch((): VaultGeneratedSaveResult => ({ saved: false, error: "failed" }));
  if (!result.saved) return result;
  forget(id);
  if (entry && result.item) rememberVaultAccount(entry.origin, result.item);
  void loadVaultItems(provider, true);
  void loadGeneratedPasswords();
  return result;
}
