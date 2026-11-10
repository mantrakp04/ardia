import type { VaultItem, VaultProviderState } from "../../platform/vaults";
import { engineProfile, privateSession } from "../browser/model";
import { useBrowser } from "../browser/store";

export const ARDIA_PROVIDER = "ardia";

export const isArdiaProvider = (id: string) => id === ARDIA_PROVIDER;

export const passwordManagersOnly = <T extends Pick<VaultProviderState, "id">>(providers: readonly T[]): T[] => providers.filter((p) => !isArdiaProvider(p.id));

export const managerItemsOnly = <T extends Pick<VaultItem, "provider">>(items: readonly T[]): T[] => items.filter((i) => !isArdiaProvider(i.provider));

export function passwordProfileOf(profileId: string): string {
  const s = useBrowser.getState();
  return privateSession(s, profileId) ?? engineProfile(s, profileId);
}

export function passwordProfileOfTab(tabId: string): string | null {
  const tab = useBrowser.getState().tabs[tabId];
  return tab ? passwordProfileOf(tab.profileId) : null;
}

export const itemsForProfile = <T extends Pick<VaultItem, "provider" | "profile">>(items: readonly T[], profile: string | null | undefined): T[] =>
  items.filter((i) => !isArdiaProvider(i.provider) || (typeof profile === "string" && i.profile === profile));

export const itemsForTab = <T extends Pick<VaultItem, "provider" | "profile">>(items: readonly T[], tabId: string): T[] => itemsForProfile(items, passwordProfileOfTab(tabId));
