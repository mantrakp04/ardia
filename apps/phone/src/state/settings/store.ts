import { create } from "zustand";
import { readPreferences, writePreference } from "../store/browserDatabase";
import { browserDatabase } from "../store/database";
import { DEFAULT_PREFERENCES, parsePreferences, PREFERENCE_KEYS, serializePreference, type Preferences } from "./preferences";

export const usePreferences = create<Preferences>()(() => DEFAULT_PREFERENCES);

export const loadPreferences = () => usePreferences.setState(parsePreferences(readPreferences(browserDatabase())));

export const currentPreferences = () => usePreferences.getState();

export function setPreference<K extends keyof Preferences>(name: K, value: Preferences[K]) {
  if (usePreferences.getState()[name] === value) return;
  writePreference(browserDatabase(), PREFERENCE_KEYS[name], serializePreference(value));
  usePreferences.setState({ [name]: value } as Pick<Preferences, K>);
}
