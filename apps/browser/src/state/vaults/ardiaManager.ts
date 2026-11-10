import { refreshProvider } from "./actions";
import { ARDIA_PROVIDER } from "./ardia";
import { loadVaultItems } from "./store";

export async function refreshArdiaManager() {
  await refreshProvider(ARDIA_PROVIDER);
  await loadVaultItems(ARDIA_PROVIDER, true);
}
