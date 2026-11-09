import { showAppleAutoFill, showAutofillSuggestions, type AppleAutoFillKind, type CardNetwork } from "../../platform/autofill";
import { useBrowser } from "../browser/store";
import { activeTabId } from "../browser/model";
import { isTabReady } from "../tabs/pageState";
import { openSettings } from "../settings/settingsWindows";
import { effectivePasswordManager } from "./passwordManager";

export { deleteAddress, deleteCard, revealCardNumber, saveAddress, saveCard, setAutofillSettings, type SavedAddress, type SavedCard } from "../../platform/autofill";

export type { CardNetwork };

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

export const cardNetworkName = (network: CardNetwork) => NETWORK_NAMES[network];

const APPLE_AUTOFILL: Record<string, AppleAutoFillKind | undefined> = { passwords: "passwords", contact: "contact", creditCard: "creditCard" };

export async function requestAutofill(windowId: string, arg: string | null, tabId = activeTabId(useBrowser.getState(), windowId)) {
  const passwords = arg === "passwords";
  const appleKind = APPLE_AUTOFILL[arg ?? ""];
  const apple = !!appleKind && effectivePasswordManager(useBrowser.getState().settings) === "apple";
  if (isTabReady(tabId) && (await (apple ? showAppleAutoFill(tabId, appleKind) : showAutofillSuggestions(tabId, passwords ? "passwords" : "field")))) return;
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  const profileId = w && w.kind !== "private" && s.profiles[w.profileId] ? w.profileId : null;
  openSettings(passwords ? "passwords" : "autofill", profileId);
}
