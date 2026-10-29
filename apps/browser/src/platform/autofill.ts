import { call, saveCard, type CardNetwork, type SavedAddress, type SavedCard, type AddressInput } from "@ardia/ardiacore";

export { saveCard };
export type { SavedAddress, SavedCard, CardNetwork };

export const getAutofillSettings = (profile = "") => call("autofill.settings", { profile });
export const setAutofillSettings = (settings: { addresses?: boolean; cards?: boolean }, profile = "") =>
  call("autofill.setSettings", { profile, ...settings });
export const listAddresses = async (profile: string) => (await call("autofill.addresses", { profile })).addresses;
export const saveAddress = async (profile: string, address: AddressInput) => (await call("autofill.saveAddress", { profile, address })).id;
export const deleteAddress = async (profile: string, id: string) => {
  await call("autofill.remove", { profile, id });
};
export const listCards = async (profile: string) => (await call("autofill.cards", { profile })).cards;
export const deleteCard = async (profile: string, id: string) => {
  await call("autofill.remove", { profile, id });
};
export const revealCardNumber = async (profile: string, id: string) => (await call("autofill.cardNumber", { profile, id })).number ?? null;
export const showAutofillSuggestions = (tabId: string, kind: "passwords" | "field") =>
  call("autofill.showSuggestions", { tabId, passwords: kind === "passwords" });
