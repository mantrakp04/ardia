import { applePasswordsAvailable, getPasswordAutofill, listPasswords, setApplePasswords, setPasswordAutofill } from "@ardia/ardiacore";
import { useBrowser, type BrowserState } from "../../store/browser";
import { engineProfile, incognitoOriginal, isIncognitoProfile } from "../../store/model";
import { DEFAULT_SETTINGS, type PasswordManager, type Settings } from "../../store/settings";
import { usePages } from "../layout/pageState";
import { resource, store as storeResource } from "../settings/resources";

const PASSWORD_MANAGERS: readonly PasswordManager[] = ["apple", "ardia", "none"];

function chosenPasswordManager(settings: Pick<Settings, "passwordManager">): PasswordManager {
  return PASSWORD_MANAGERS.includes(settings.passwordManager) ? settings.passwordManager : DEFAULT_SETTINGS.passwordManager;
}

export function effectivePasswordManager(settings: Pick<Settings, "passwordManager">): PasswordManager {
  const chosen = chosenPasswordManager(settings);
  return chosen === "apple" && !applePasswordsAvailable() ? "ardia" : chosen;
}

export const passwordAutofill = resource("passwordAutofill", (profile: string) => getPasswordAutofill(profile).catch(() => true));
export const ardiaLoginCount = resource("ardiaLoginCount", (profile: string) =>
  listPasswords(profile).then(
    (list) => list.length,
    () => 0,
  ),
);

export const PASSWORD_PREF_RETRY_MS = 1500;

const browser = () => useBrowser.getState();

const regularProfile = (profileId: string) => (isIncognitoProfile(profileId) ? incognitoOriginal(profileId) : profileId);

function shownEngineProfiles(s: BrowserState): Set<string> {
  const shown = new Set<string>();
  for (const w of Object.values(s.windows)) if (w) shown.add(engineProfile(regularProfile(w.profileId)));
  return shown;
}

const knownEngineProfiles = (s: BrowserState) => new Set([...Object.keys(s.profiles).map(engineProfile), ...shownEngineProfiles(s)]);

function offerToSave(profile: string, on: boolean) {
  void setPasswordAutofill(on, profile).then(
    () => storeResource(passwordAutofill, [profile], on),
    () => {},
  );
}

let started = false;

export function startPasswordManager() {
  if (started) return;
  started = true;
  let mode: PasswordManager | null = null;
  let seen = new Set<string>();
  const owedOn = new Set<string>();
  const ready = new Set<string>();
  const ardiaLogins = new Map<string, number>();

  const upgradedIntoArdia = () => {
    const { settings } = browser();
    return settings.passwordManager === "ardia" && !!settings.inferred?.includes("passwordManager");
  };
  const adoptAppleIfNothingSaved = (profile: string) => {
    if (!upgradedIntoArdia() || !applePasswordsAvailable() || ardiaLogins.has(profile)) return;
    void listPasswords(profile).then(
      (list) => {
        ardiaLogins.set(profile, list.length);
        const profiles = Object.keys(browser().profiles).map(engineProfile);
        if (upgradedIntoArdia() && profiles.every((p) => ardiaLogins.get(p) === 0)) browser().updateSettings({ passwordManager: "apple" }, { fromSync: true });
      },
      () => {},
    );
  };

  const wants = (profile: string): boolean | null => (mode !== "ardia" ? false : owedOn.has(profile) ? true : null);

  const applyShown = (profile: string) => {
    const on = wants(profile);
    if (on === null) return;
    owedOn.delete(profile);
    offerToSave(profile, on);
    const at = mode;
    setTimeout(() => mode === at && offerToSave(profile, on), PASSWORD_PREF_RETRY_MS);
  };

  const syncMode = () => {
    const next = effectivePasswordManager(browser().settings);
    if (next === mode) return;
    const switching = mode !== null;
    mode = next;
    void setApplePasswords(next === "apple");
    owedOn.clear();
    ready.clear();
    if (next === "ardia" && !switching) return;
    const shown = shownEngineProfiles(browser());
    for (const profile of knownEngineProfiles(browser())) {
      if (next === "ardia" && !shown.has(profile)) owedOn.add(profile);
      offerToSave(profile, next === "ardia");
    }
  };

  const syncWindows = () => {
    const shown = shownEngineProfiles(browser());
    for (const profile of shown) if (!seen.has(profile)) applyShown(profile);
    seen = shown;
  };

  const syncReady = () => {
    const tabs = browser().tabs;
    for (const tabId of Object.values(usePages.getState().browsers)) {
      const tab = tabs[tabId];
      const profile = tab && engineProfile(regularProfile(tab.profileId));
      if (profile === undefined || ready.has(profile)) continue;
      ready.add(profile);
      adoptAppleIfNothingSaved(profile);
      const on = mode === "ardia" ? (owedOn.has(profile) ? true : null) : false;
      if (on === null) continue;
      owedOn.delete(profile);
      offerToSave(profile, on);
    }
  };

  syncMode();
  syncWindows();
  syncReady();
  usePages.subscribe((s, prev) => s.browsers !== prev.browsers && syncReady());
  useBrowser.subscribe((s, prev) => {
    if (s.settings !== prev.settings) syncMode();
    if (s.windows !== prev.windows) syncWindows();
  });
}
