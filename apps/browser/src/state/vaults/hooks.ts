import { useVaultCodes } from "./codes";
import { useMemo } from "react";
import { rowsOfMenu, useVaultMenus, type VaultMenu } from "./menu";
import { useVaultSaveOffers } from "./saveOffer";
import { useVaults } from "./store";
import { useBrowser } from "../browser/store";
import { useVaultBiometrics } from "./biometrics";

export const useVaultProviders = () => useVaults((s) => s.providers);
export const useVaultProvider = (id: string) => useVaults((s) => s.providers.find((p) => p.id === id));
export const useVaultTouchID = () => {
  const available = useVaultBiometrics((s) => s.available);
  const asks = useBrowser((s) => s.settings.vaultAskBeforeFilling);
  return available && asks;
};
export const useVaultMenuGlass = () => useBrowser((s) => s.settings.vaultMenuGlass);
export function useVaultLogins() {
  const items = useVaults((s) => s.items);
  const providers = useVaults((s) => s.providers);
  return useMemo(() => {
    const unlocked = new Set(providers.filter((p) => p.state === "unlocked").map((p) => p.id));
    return Object.values(items)
      .flat()
      .filter((i) => unlocked.has(i.provider));
  }, [items, providers]);
}
export const useLockedVaults = () => {
  const providers = useVaults((s) => s.providers);
  return useMemo(() => providers.filter((p) => p.state === "locked"), [providers]);
};
export const useVaultsLoaded = () => useVaults((s) => s.loaded);
export const useVaultCode = (key: string) => useVaultCodes((s) => s[key]);
export const useVaultMenu = (tabId: string) => useVaultMenus((s) => s.menus[tabId] ?? null);
export const useVaultSaveOffer = (tabId: string) => useVaultSaveOffers((s) => s[tabId] ?? null);

export function useVaultMenuRows(menu: VaultMenu) {
  const revision = useVaults((s) => s.revision);
  return useMemo(() => rowsOfMenu(menu), [menu, revision]);
}
