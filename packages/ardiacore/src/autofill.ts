import { ardiaError, call } from "./engine/call";
import { nativeModule } from "./nativeModules";
export type SavedAddress = {
  id: string;
  name?: string;
  organization?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  email?: string;
  created: number;
  modified: number;
};
export type AddressInput = Partial<Omit<SavedAddress, "created" | "modified">>;

export type CardNetwork = "visa" | "mastercard" | "amex" | "discover" | "diners" | "jcb" | "unionpay" | "card";
export type SavedCard = {
  id: string;
  name?: string;
  network: CardNetwork;
  last4: string;
  expMonth?: number;
  expYear?: number;
  created: number;
  modified: number;
};
export type CardInput = { id?: string; name?: string; expMonth?: number; expYear?: number };

const Autofill = nativeModule("ArdiaAutofill");

export const getAutofillSettings = (profile = "") => call("autofill.settings", { profile });
export const setAutofillSettings = (settings: { addresses?: boolean; cards?: boolean }, profile = "") =>
  call("autofill.setSettings", { profile, ...settings });
export const listAddresses = async (profile: string): Promise<SavedAddress[]> => (await call("autofill.addresses", { profile })).addresses;
export const saveAddress = async (profile: string, address: AddressInput) => (await call("autofill.saveAddress", { profile, address })).id;
export const deleteAddress = async (profile: string, id: string) => {
  await call("autofill.remove", { profile, id });
};
export const listCards = async (profile: string): Promise<SavedCard[]> => (await call("autofill.cards", { profile })).cards;
export const saveCard = async (profile: string, card: CardInput, number?: string) => {
  try {
    return (JSON.parse(await Autofill.saveCard(profile, card, number ?? null)) as { id: string }).id;
  } catch (error) {
    throw ardiaError(error);
  }
};
export const deleteCard = async (profile: string, id: string) => {
  await call("autofill.remove", { profile, id });
};
export const revealCardNumber = async (profile: string, id: string) => (await call("autofill.cardNumber", { profile, id })).number ?? null;

const NETWORK_NAMES: Record<CardNetwork, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
  card: "Card",
};
export const cardNetworkName = (network: CardNetwork) => NETWORK_NAMES[network] ?? "Card";
