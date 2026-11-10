import { create } from "zustand";
import { ago } from "../live/meetings";
import { syncVaults, vaultSyncStatus, type VaultSyncResult } from "../../platform/vaults";
import { unlockProvider } from "./actions";
import { currentVaultProviders, loadAllVaultItems } from "./store";

export type VaultSyncPhase = "idle" | "syncing" | "synced" | "failed";

type VaultSyncState = { phase: VaultSyncPhase; syncedAt: number | null; iCloud: boolean; failed: string[] };

export const useVaultSync = create<VaultSyncState>()(() => ({ phase: "idle", syncedAt: null, iCloud: false, failed: [] }));

export const SYNCED_SHOWN_MS = 2000;

export const syncedLine = (syncedAt: number | null, now: number) => (syncedAt ? `Synced ${ago(syncedAt, now)}` : undefined);

let resetTimer: ReturnType<typeof setTimeout> | null = null;

function settle(result: VaultSyncResult | null) {
  if (resetTimer) clearTimeout(resetTimer);
  const phase: VaultSyncPhase = result?.ok ? "synced" : "failed";
  useVaultSync.setState((s) => ({ phase, syncedAt: result?.syncedAt ?? s.syncedAt, iCloud: result?.iCloud ?? s.iCloud, failed: result?.failed ?? [] }));
  if (phase === "failed") return;
  resetTimer = setTimeout(() => {
    resetTimer = null;
    useVaultSync.setState((s) => (s.phase === "syncing" ? s : { phase: "idle" }));
  }, SYNCED_SHOWN_MS);
}

export async function refreshVaultSyncStatus() {
  const status = await vaultSyncStatus().catch(() => null);
  if (status) useVaultSync.setState({ syncedAt: status.syncedAt, iCloud: status.iCloud });
}

export async function syncVaultsNow(): Promise<VaultSyncResult | null> {
  if (useVaultSync.getState().phase === "syncing") return null;
  useVaultSync.setState({ phase: "syncing", failed: [] });
  const providers = currentVaultProviders();
  if (!providers.some((p) => p.state === "unlocked")) {
    const locked = providers.find((p) => p.state === "locked" && p.touchUnlock);
    if (locked) await unlockProvider(locked.id, null);
  }
  const result = await syncVaults().catch(() => null);
  await loadAllVaultItems(true);
  settle(result);
  return result;
}
