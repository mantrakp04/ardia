import { create } from "zustand";
import { onAppEvent } from "../../platform/app";
import { onVaultChanged, onVaultItemsChanged, vaultItems, vaultProviders, type VaultItem, type VaultProviderState } from "../../platform/vaults";
import { byBrandOrder } from "./brands";
import { clearVaultCodes } from "./codes";
import { forgetMissingVaultAccounts } from "./accounts";
import { forgetPending, keepListedPending, type PendingTotp } from "./pendingTotp";

type VaultsState = {
  providers: VaultProviderState[];
  items: Record<string, VaultItem[]>;
  pending: PendingTotp[];
  loaded: boolean;
  revision: number;
};

export const useVaults = create<VaultsState>()(() => ({ providers: [], items: {}, pending: [], loaded: false, revision: 0 }));

const ITEMS_FRESH_MS = 30_000;
const fetchedAt = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();

const vaults = () => useVaults.getState();
const change = (patch: (s: VaultsState) => Partial<VaultsState>) => useVaults.setState((s) => ({ ...patch(s), revision: s.revision + 1 }));

export const isConnected = (p: Pick<VaultProviderState, "state">) => p.state === "unlocked" || p.state === "locked";
export const currentVaultProviders = () => vaults().providers;
export const vaultProviderOf = (id: string) => vaults().providers.find((p) => p.id === id);
export const anyVaultConnected = () => vaults().providers.some(isConnected);
export const anyVaultUnlocked = () => vaults().providers.some((p) => p.state === "unlocked");
export const allVaultItems = (): VaultItem[] => Object.values(vaults().items).flat();
export const vaultRevision = () => vaults().revision;
export const currentPendingTotp = () => vaults().pending;
export const setPendingTotp = (pending: PendingTotp[]) => change(() => ({ pending }));

function dropItems(s: VaultsState, provider: string) {
  fetchedAt.delete(provider);
  clearVaultCodes();
  if (!(provider in s.items)) return { items: s.items, pending: forgetPending(s.pending, provider) };
  const { [provider]: _gone, ...items } = s.items;
  return { items, pending: forgetPending(s.pending, provider) };
}

export function applyProviderState(state: VaultProviderState) {
  const before = vaultProviderOf(state.id);
  change((s) => {
    const others = s.providers.filter((p) => p.id !== state.id);
    const providers = byBrandOrder([...others, state]);
    return state.state === "unlocked" ? { providers } : { providers, ...dropItems(s, state.id) };
  });
  if (state.state === "unlocked" && before?.state !== "unlocked") void loadVaultItems(state.id, true);
}

export function clearVaultIndex() {
  fetchedAt.clear();
  clearVaultCodes();
  change(() => ({ items: {}, pending: [] }));
}

export async function loadVaultProviders() {
  try {
    const providers = await vaultProviders();
    change(() => ({ providers: byBrandOrder(providers), loaded: true }));
    for (const p of providers) if (p.state === "unlocked") void loadVaultItems(p.id);
  } catch {
    change(() => ({ loaded: true }));
  }
}

async function fetchItems(provider: string) {
  try {
    const items = await vaultItems(provider);
    if (vaultProviderOf(provider)?.state !== "unlocked") return;
    fetchedAt.set(provider, Date.now());
    const listed = items.filter((i) => i.provider === provider);
    const ids = new Set(listed.map((i) => i.id));
    const prune = listed.length > 0;
    change((s) => ({ items: { ...s.items, [provider]: listed }, pending: prune ? keepListedPending(s.pending, provider, ids) : s.pending }));
    if (prune) forgetMissingVaultAccounts(provider, ids);
  } catch {
    fetchedAt.delete(provider);
  }
}

export function loadVaultItems(provider: string, force = false): Promise<void> {
  if (vaultProviderOf(provider)?.state !== "unlocked") return Promise.resolve();
  if (!force && Date.now() - (fetchedAt.get(provider) ?? 0) < ITEMS_FRESH_MS) return Promise.resolve();
  const running = inFlight.get(provider);
  if (running) return running;
  const run = fetchItems(provider).finally(() => inFlight.delete(provider));
  inFlight.set(provider, run);
  return run;
}

export const loadAllVaultItems = (force = false) =>
  Promise.all(vaults().providers.filter((p) => p.state === "unlocked").map((p) => loadVaultItems(p.id, force))).then(() => undefined);

let started = false;

export function startVaultIndex() {
  if (started) return;
  started = true;
  onVaultChanged(applyProviderState);
  onVaultItemsChanged((provider) => void loadVaultItems(provider, true));
  onAppEvent((e) => e.type === "lockedOrAsleep" && clearVaultIndex());
  void loadVaultProviders();
}
