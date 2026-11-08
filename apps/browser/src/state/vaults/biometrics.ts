import { create } from "zustand";
import { vaultBiometrics } from "../../platform/vaults";

export const useVaultBiometrics = create<{ available: boolean }>()(() => ({ available: false }));

export function refreshVaultBiometrics() {
  void vaultBiometrics().then(
    (available) => useVaultBiometrics.setState({ available }),
    () => useVaultBiometrics.setState({ available: false }),
  );
}
