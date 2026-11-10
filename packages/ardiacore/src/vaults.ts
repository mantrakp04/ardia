import { decodeReply } from "./engine/call";
import { nativeModule } from "./nativeModules";

export type VaultProviderId = "1password" | "bitwarden" | "protonpass" | (string & {});
export type VaultState = "notInstalled" | "signedOut" | "locked" | "unlocked" | "unavailable";
export type VaultSecretField = "username" | "password";
export type VaultCapabilities = { totp: boolean; save: boolean; selfHosted: boolean; masterPassword: boolean; touchID: boolean };
export type VaultSetupKind = "desktopIntegration" | "browserSignIn" | "credentials";

export type VaultProviderState = {
  id: VaultProviderId;
  name: string;
  state: VaultState;
  account?: string;
  server?: string;
  cliPath?: string;
  cliVersion?: string;
  message?: string;
  capabilities: VaultCapabilities;
  install: { command: string; url: string };
  setup?: { kind: VaultSetupKind; appURL?: string };
  touchUnlock?: boolean;
};

export type VaultItem = {
  provider: VaultProviderId;
  id: string;
  title: string;
  username: string;
  urls: string[];
  hasTotp?: boolean;
  vault?: string;
  favorite?: boolean;
  updatedAt?: number;
};

export type VaultSignInMethod = { id: string; name: string };

export type VaultSignInResult = {
  ok: boolean;
  state: VaultProviderState;
  needs?: "code" | "password" | "email" | "approval";
  methods?: VaultSignInMethod[];
  error?: string;
  approvalURL?: string;
};

export type VaultSignInFields = {
  email?: string;
  password?: string;
  code?: string;
  method?: string;
  server?: string;
  clientId?: string;
  clientSecret?: string;
  account?: string;
};

export type VaultTotp = { code: string; period: number; expiresAt: number };

export type VaultSyncResult = { ok: boolean; synced: VaultProviderId[]; failed: VaultProviderId[]; syncedAt: number | null; iCloud: boolean };

const Vaults = nativeModule("ArdiaVaults");

export const signInToVault = (provider: VaultProviderId, fields: VaultSignInFields) =>
  decodeReply<VaultSignInResult>(Vaults.signIn(provider, JSON.stringify(fields)));
export const unlockVault = (provider: VaultProviderId, password: string | null) =>
  decodeReply<VaultSignInResult>(Vaults.unlock(provider, password));
