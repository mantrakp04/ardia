import * as shared from "../../browser/src/state/settings/paneData";
import { load, loadAll, resource, useAllLoaded, type Needed } from "../../browser/src/state/settings/resources";
import { getAutofillSettings, listAddresses, listCards, type SavedAddress, type SavedCard } from "../../browser/src/platform/autofill";
import { getPasswordAutofill } from "../../browser/src/platform/passwords";
import type { SettingsPane } from "../../browser/src/state/settings/settingsWindows";

export * from "../../browser/src/state/settings/paneData";

const unreadable = (error: unknown): undefined => {
  console.warn(`[engine] ${error instanceof Error ? error.message : String(error)}`);
  return undefined;
};

export const passwordAutofill = resource("passwordAutofill", (profile: string): Promise<boolean | undefined> => getPasswordAutofill(profile).catch(unreadable));
export const addresses = resource("addresses", (profile: string): Promise<SavedAddress[] | undefined> => listAddresses(profile).catch(unreadable));
export const cards = resource("cards", (profile: string): Promise<SavedCard[] | undefined> => listCards(profile).catch(unreadable));
export const autofillEnabled = resource("autofillEnabled", (profile: string) =>
  load(addresses, [profile]).then(
    () => getAutofillSettings(profile).catch(unreadable),
    () => getAutofillSettings(profile).catch(unreadable),
  ),
);

const linuxResources = new Map<unknown, Needed[0]>([
  [shared.passwordAutofill, passwordAutofill as unknown as Needed[0]],
  [shared.addresses, addresses as unknown as Needed[0]],
  [shared.cards, cards as unknown as Needed[0]],
  [shared.autofillEnabled, autofillEnabled as unknown as Needed[0]],
]);

export function paneNeeds(pane: SettingsPane, profileId: string | null): Needed[] {
  return shared.paneNeeds(pane, profileId).map(([needed, args]): Needed => [linuxResources.get(needed) ?? needed, args]);
}

export const usePaneLoaded = (pane: SettingsPane, profileId: string | null) => useAllLoaded(paneNeeds(pane, profileId));

export const preparePane = (pane: SettingsPane, profileId: string | null) => loadAll(paneNeeds(pane, profileId));
