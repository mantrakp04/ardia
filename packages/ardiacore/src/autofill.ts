import { decodeReply } from "./engine/call";
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

export const saveCard = async (profile: string, card: CardInput, number?: string) =>
  (await decodeReply<{ id: string }>(Autofill.saveCard(profile, card, number ?? null))).id;
