import { showAutofillSuggestions, type CardNetwork } from "../../platform/autofill";
import { useBrowser } from "../browser/store";
import { activeTabId } from "../browser/model";
import { isTabReady } from "../tabs/pageState";
import { openSettings } from "../settings/settingsWindows";

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

export async function requestAutofill(windowId: string, arg: string | null, tabId = activeTabId(useBrowser.getState(), windowId)) {
  const passwords = arg === "passwords";
  if (isTabReady(tabId) && (await showAutofillSuggestions(tabId, passwords ? "passwords" : "field"))) return;
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  const profileId = w && w.kind !== "private" && s.profiles[w.profileId] ? w.profileId : null;
  openSettings(passwords ? "passwords" : "autofill", profileId);
}
