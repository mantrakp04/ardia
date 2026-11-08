import {
  cancelVaultSignIn,
  configureVault,
  lockVault,
  refreshVault,
  signInVault,
  signOutVault,
  unlockVault,
  type VaultProviderState,
  type VaultSignInFields,
  type VaultSignInResult,
} from "../../platform/vaults";
import { openExternalURL } from "../../platform/app";
import { copyText } from "../../platform/clipboard";
import { openSettings, openUrlFromSettings } from "../settings/settingsWindows";
import { applyProviderState, clearVaultIndex, currentVaultProviders, loadVaultProviders, vaultProviderOf } from "./store";
import { brandOf } from "./brands";

export type { VaultProviderState, VaultSignInFields, VaultSignInResult };

const FAILED = "failed";

function failure(provider: string, error: string): VaultSignInResult {
  const state = vaultProviderOf(provider);
  return state ? { ok: false, state, error } : ({ ok: false, error } as VaultSignInResult);
}

async function withResult(provider: string, run: () => Promise<VaultSignInResult>): Promise<VaultSignInResult> {
  try {
    const result = await run();
    if (result.state) applyProviderState(result.state);
    return result;
  } catch {
    return failure(provider, FAILED);
  }
}

async function withState(run: () => Promise<VaultProviderState>): Promise<VaultProviderState | null> {
  try {
    const state = await run();
    applyProviderState(state);
    return state;
  } catch {
    return null;
  }
}

export const unlockProvider = (provider: string, password: string | null = null) => withResult(provider, () => unlockVault(provider, password));
export const signInProvider = (provider: string, fields: VaultSignInFields) => withResult(provider, () => signInVault(provider, fields));
export const lockProvider = (provider: string) => withState(() => lockVault(provider));
export const signOutProvider = (provider: string) => withState(() => signOutVault(provider));
export const refreshProvider = (provider: string) => withState(() => refreshVault(provider));
export const configureProvider = (provider: string, server: string | null) => withState(() => configureVault(provider, server));
export const cancelProviderSignIn = (provider: string) => withState(() => cancelVaultSignIn(provider));

export async function lockAllProviders() {
  const unlocked = currentVaultProviders().filter((p) => p.state === "unlocked");
  clearVaultIndex();
  await Promise.all(unlocked.map((p) => lockProvider(p.id)));
}

export const reloadProviders = () => loadVaultProviders();

export const openProviderApp = (url: string) => void openExternalURL(url);
export const openApprovalPage = (url: string) => openUrlFromSettings(url);
export const openPasswordSettings = () => openSettings("passwords");
export const copyInstallCommand = (command: string) => copyText(command);
export const installCommandOf = (p: VaultProviderState) => p.install?.command || brandOf(p.id).install;

export function signInError(result: VaultSignInResult, name: string): string {
  if (result.ok) return "";
  if (result.error && result.error !== FAILED) return result.error;
  return `${name} didn't respond. Try again.`;
}
