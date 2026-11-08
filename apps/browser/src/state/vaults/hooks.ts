import { useVaultCodes } from "./codes";
import { useMemo } from "react";
import { rowsOfMenu, useVaultMenus, type VaultMenu } from "./menu";
import { useVaultSaveOffers } from "./saveOffer";
import { useVaults } from "./store";

export const useVaultProviders = () => useVaults((s) => s.providers);
export const useVaultProvider = (id: string) => useVaults((s) => s.providers.find((p) => p.id === id));
export const useVaultsLoaded = () => useVaults((s) => s.loaded);
export const useVaultCode = (key: string) => useVaultCodes((s) => s[key]);
export const useVaultMenu = (tabId: string) => useVaultMenus((s) => s.menus[tabId] ?? null);
export const useVaultSaveOffer = (tabId: string) => useVaultSaveOffers((s) => s[tabId] ?? null);

export function useVaultMenuRows(menu: VaultMenu) {
  const revision = useVaults((s) => s.revision);
  return useMemo(() => rowsOfMenu(menu), [menu, revision]);
}
