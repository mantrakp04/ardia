import { usePreferences as usePreferencesStore } from "./store";
import type { Preferences } from "./preferences";

export const usePreferences = <T>(select: (preferences: Preferences) => T) => usePreferencesStore(select);
