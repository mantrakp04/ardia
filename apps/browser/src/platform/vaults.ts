import {
  call,
  type CallArgs,
  on,
  signInToVault,
  unlockVault as unlockNativeVault,
  type VaultGeneratedPassword,
  type VaultGeneratedSaveResult,
  type VaultItem,
  type VaultProviderState,
  type VaultSecretField,
  type VaultSignInFields,
  type VaultSignInResult,
  type VaultSyncResult,
  type VaultTotp,
} from "@ardia/ardiacore";

export type { VaultGeneratedPassword, VaultGeneratedSaveResult, VaultItem, VaultProviderState, VaultSignInFields, VaultSignInResult, VaultSyncResult, VaultTotp };

export type VaultCopyField = VaultSecretField;

export const vaultProviders = () => call("vaults.providers");
export const refreshVault = (provider: string) => call("vaults.refresh", { provider });
export const vaultItems = (provider?: string) => call("vaults.items", provider ? { provider } : {});
export const lockVault = (provider: string) => call("vaults.lock", { provider });
export const signOutVault = (provider: string) => call("vaults.signOut", { provider });
export const configureVault = (provider: string, server: string | null) => call("vaults.configure", { provider, server });
export const copyFromVault = (provider: string, id: string, field: VaultCopyField) => call("vaults.copy", { provider, id, field });
export const vaultTotp = (provider: string, id: string) => call("vaults.totp", { provider, id });
export const cancelVaultSignIn = (provider: string) => call("vaults.cancelSignIn", { provider });
export type VaultOptions = CallArgs<"vaults.setOptions">;
export const setVaultOptions = (options: VaultOptions) => call("vaults.setOptions", options);
export const exportVault = (provider: string) => call("vaults.export", { provider });
export const syncVaults = () => call("vaults.sync", {});
export const vaultSyncStatus = () => call("vaults.syncStatus", {});
export const vaultBiometrics = () => call("vaults.biometrics", {}).then((r) => r.available);

export const listGeneratedPasswords = () => call("vaults.listGenerated", {});
export const copyGeneratedPassword = (id: string) => call("vaults.copyGenerated", { id });
export const saveGeneratedPassword = (id: string, provider: string, username: string | null) =>
  call("vaults.saveGenerated", username ? { id, provider, username } : { id, provider });
export const deleteGeneratedPassword = (id: string) => call("vaults.deleteGenerated", { id });
export const setGeneratedRetention = (days: number) => call("vaults.setGeneratedRetention", { days });
export const onGeneratedPasswordsChanged = (listener: () => void) => on("vaults.generatedChanged", () => listener());

export const signInVault = (provider: string, fields: VaultSignInFields) => signInToVault(provider, fields);
export const unlockVault = (provider: string, password: string | null) => unlockNativeVault(provider, password);

export const onVaultChanged = (listener: (state: VaultProviderState) => void) => on("vaults.changed", ({ provider }) => listener(provider));
export const onVaultItemsChanged = (listener: (provider: string) => void) => on("vaults.itemsChanged", ({ provider }) => listener(provider));

export type { VaultField, VaultFieldKind, VaultFieldRect, VaultFillError, VaultFillField, VaultKeyPress, VaultPasswordDraft, VaultPasswordStyle, VaultSubmission, VaultTouchIDStatus } from "@ardia/ardiacore";
export type { VaultContextAction, VaultContextChoice, VaultContextField, VaultContextLogin, VaultContextMenu, VaultFillTarget } from "@ardia/ardiacore";
