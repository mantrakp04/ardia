import { usePreferences } from "../settings/store";
import { useSync } from "./store";
import { isSyncConnected, matchedColor, profileOf } from "./syncRules";

export const useSyncStatus = () => useSync((s) => s.status);

export const useSyncView = () => useSync((s) => s.view);

export const useSyncAvailable = () => useSync((s) => s.available);

export const useSyncEnabled = () => useSync((s) => s.status.isEnabled);

export const useSyncConnected = () => useSync((s) => isSyncConnected(s.status));

export function useSelectedProfile() {
  return useSync((s) => (s.status.isEnabled ? profileOf(s.view, s.status.selectedProfileId ?? s.view.selectedProfileId) : null));
}

export function useLookColor<K extends string>(swatches: readonly { key: K; hex: string }[], fallback: K): K {
  const choice = usePreferences((p) => p.colorChoice) as K | null;
  const profile = useSelectedProfile();
  if (choice) return choice;
  return matchedColor(profile, swatches) ?? fallback;
}
