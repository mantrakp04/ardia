import { usePreferences } from "../settings/store";
import { useTab } from "../tabs/hooks";
import { isSyncableUrl } from "../tabs/tabModels";
import { isPinnedOnMac } from "./spaces";
import { useSync } from "./store";
import { isSyncConnected, matchedColor, sendReceivers, shownProfile } from "./syncRules";

export const useSyncStatus = () => useSync((s) => s.status);

export const useSyncView = () => useSync((s) => s.view);

export const useSyncAvailable = () => useSync((s) => s.available);

export const useSyncEnabled = () => useSync((s) => s.status.isEnabled);

export const useSyncConnected = () => useSync((s) => isSyncConnected(s.status));

export function useSelectedProfile() {
  return useSync((s) => shownProfile(s.view, s.status));
}

export function useLookColor<K extends string>(swatches: readonly { key: K; hex: string }[], fallback: K): K {
  const choice = usePreferences((p) => p.colorChoice) as K | null;
  const profile = useSelectedProfile();
  if (choice) return choice;
  return matchedColor(profile, swatches) ?? fallback;
}

export function useSendTargets(tabId: string) {
  const tab = useTab(tabId);
  const status = useSyncStatus();
  const view = useSyncView();
  const profile = useSelectedProfile();
  if (!tab || tab.isPrivate || !status.isEnabled || !isSyncableUrl(tab.url)) return [];
  return sendReceivers(view, tab.profileSyncId ?? profile?.syncId ?? null);
}

export function useIsPinned(tabId: string) {
  const tab = useTab(tabId);
  const profile = useSelectedProfile();
  return Boolean(tab && profile && isPinnedOnMac(profile, tab.url));
}
