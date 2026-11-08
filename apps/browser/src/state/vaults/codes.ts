import { create } from "zustand";
import { vaultTotp, type VaultItem, type VaultTotp } from "../../platform/vaults";
import { itemKey } from "./menuModel";

export type VaultCode = VaultTotp | "loading" | "none";

export const useVaultCodes = create<Record<string, VaultCode>>()(() => ({}));

const set = (key: string, code: VaultCode | null) =>
  useVaultCodes.setState((s) => {
    if (code) return { ...s, [key]: code };
    const { [key]: _gone, ...rest } = s;
    return rest;
  }, true);

export async function loadVaultCode(item: Pick<VaultItem, "provider" | "id">): Promise<VaultCode> {
  const key = itemKey(item);
  const known = useVaultCodes.getState()[key];
  if (known === "loading" || known === "none") return known;
  if (known && known.expiresAt > Date.now()) return known;
  set(key, "loading");
  const code: VaultCode = await vaultTotp(item.provider, item.id).then(
    (totp) => (totp?.code ? totp : "none"),
    () => "none",
  );
  if (useVaultCodes.getState()[key] === "loading") set(key, code);
  return code;
}

export const forgetVaultCode = (item: Pick<VaultItem, "provider" | "id">) => set(itemKey(item), null);
export const clearVaultCodes = () => useVaultCodes.setState({}, true);
