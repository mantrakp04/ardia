import { call, on, signInToVault, unlockVault as unlockNativeVault, type VaultItem, type VaultProviderState, type VaultSecretField, type VaultSignInFields, type VaultSignInResult, type VaultTotp } from "@ardia/ardiacore";

export type { VaultItem, VaultProviderState, VaultSignInFields, VaultSignInResult, VaultTotp };

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
export const setVaultOptions = (idleLockMinutes: number, touchID: boolean, askBeforeFilling: boolean, loadPasswordsWhenUsed: boolean) =>
  call("vaults.setOptions", { idleLockMinutes, touchID, askBeforeFilling, loadPasswordsWhenUsed });
export const vaultBiometrics = () => call("vaults.biometrics", {}).then((r) => r.available);

export const signInVault = (provider: string, fields: VaultSignInFields) => signInToVault(provider, fields);
export const unlockVault = (provider: string, password: string | null) => unlockNativeVault(provider, password);

export const onVaultChanged = (listener: (state: VaultProviderState) => void) => on("vaults.changed", ({ provider }) => listener(provider));
export const onVaultTouchID = (listener: () => void) => on("vaults.touchID", () => listener());
export const onVaultItemsChanged = (listener: (provider: string) => void) => on("vaults.itemsChanged", ({ provider }) => listener(provider));

export type { VaultField, VaultFieldKind, VaultFieldRect, VaultFillError, VaultFillField, VaultKeyPress, VaultPasswordStyle, VaultSubmission, VaultTouchIDStatus } from "@ardia/ardiacore";
