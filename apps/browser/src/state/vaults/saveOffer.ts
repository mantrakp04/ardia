import { create } from "zustand";
import type { VaultItem, VaultProviderState } from "../../platform/vaults";
import { webviews } from "../../platform/webviews";
import { showToast } from "../app/toasts";
import { useBrowser } from "../browser/store";
import { patchPage, pageOf } from "../tabs/pageState";
import { brandOf } from "./brands";
import { isSecureOrigin, loginSavedIn, sameSite, siteLabel } from "./originMatch";
import { PENDING_TOTP_MS } from "./pendingTotp";
import { allVaultItems, currentVaultProviders, loadAllVaultItems, loadVaultItems, vaultProviderOf } from "./store";
import type { VaultSubmittedEvent } from "./types";

export type VaultSaveOffer = { seq: number; origin: string; username: string; targets: string[]; target: string; busy: boolean; error: string | null };

export const useVaultSaveOffers = create<Record<string, VaultSaveOffer | null>>()(() => ({}));

export const SAVE_OFFER_MS = PENDING_TOTP_MS;

type SaveInput = { enabled: boolean; origin: string; username: string; providers: readonly VaultProviderState[]; items: readonly VaultItem[]; preferred: string };
export type SaveDecision = { offer: false; alreadySaved: boolean } | { offer: true; targets: string[]; target: string };

export const saveTargets = (providers: readonly VaultProviderState[]) => providers.filter((p) => p.state === "unlocked" && p.capabilities.save).map((p) => p.id);

export const chooseSaveTarget = (targets: readonly string[], preferred: string) => (targets.includes(preferred) ? preferred : (targets[0] ?? ""));

export function decideSave({ enabled, origin, username, providers, items, preferred }: SaveInput): SaveDecision {
  const unlocked = new Set(providers.filter((p) => p.state === "unlocked").map((p) => p.id));
  if (loginSavedIn(items.filter((i) => unlocked.has(i.provider)), origin, username)) return { offer: false, alreadySaved: true };
  const targets = saveTargets(providers);
  if (!enabled || !isSecureOrigin(origin) || !targets.length) return { offer: false, alreadySaved: false };
  const target = chooseSaveTarget(targets, preferred);
  return { offer: true, targets: target === preferred ? [target] : targets, target };
}

type Claim = { origin: string; at: number; offered: boolean };
const claims = new Map<string, Claim>();
const expiries = new Map<string, ReturnType<typeof setTimeout>>();
let seq = 0;

export function vaultClaimsPasswordPrompt(tabId: string, prompt: { origin: string; state: string }, now = Date.now()): boolean {
  const claim = claims.get(tabId);
  if (!claim || now - claim.at > SAVE_OFFER_MS || !sameSite(claim.origin, prompt.origin)) return false;
  return claim.offered || prompt.state === "save";
}

const offerOf = (tabId: string) => useVaultSaveOffers.getState()[tabId] ?? null;
function setOffer(tabId: string, offer: VaultSaveOffer | null) {
  const replaced = offerOf(tabId)?.seq !== offer?.seq;
  if (replaced) {
    clearTimeout(expiries.get(tabId));
    expiries.delete(tabId);
  }
  useVaultSaveOffers.setState((s) => ({ ...s, [tabId]: offer }));
  if (replaced && offer) expiries.set(tabId, setTimeout(() => offerOf(tabId)?.seq === offer.seq && dismissVaultOffer(tabId), SAVE_OFFER_MS));
}
const discard = (tabId: string, origin: string) => void webviews.get(tabId)?.discardVaultCapture({ origin })?.catch(() => {});

function claim(tabId: string, origin: string, offered: boolean) {
  claims.set(tabId, { origin, at: Date.now(), offered });
  const chrome = pageOf(tabId).passwordPrompt;
  if (chrome && vaultClaimsPasswordPrompt(tabId, chrome)) patchPage(tabId, { passwordPrompt: null });
}

export async function noteVaultSubmitted(tabId: string, event: VaultSubmittedEvent) {
  await loadAllVaultItems();
  const settings = useBrowser.getState().settings;
  const decision = decideSave({
    enabled: settings.vaultSaveOffer,
    origin: event.origin,
    username: event.username,
    providers: currentVaultProviders(),
    items: allVaultItems(),
    preferred: settings.vaultSaveTarget,
  });
  if (!decision.offer) {
    if (decision.alreadySaved) claim(tabId, event.origin, false);
    return discard(tabId, event.origin);
  }
  const old = offerOf(tabId);
  if (old && old.origin !== event.origin) discard(tabId, old.origin);
  const offer: VaultSaveOffer = { seq: ++seq, origin: event.origin, username: event.username, targets: decision.targets, target: decision.target, busy: false, error: null };
  setOffer(tabId, offer);
  claim(tabId, event.origin, true);
}

const patchOffer = (tabId: string, s: number, patch: Partial<VaultSaveOffer>) => {
  const offer = offerOf(tabId);
  if (offer?.seq === s) setOffer(tabId, { ...offer, ...patch });
};

export const chooseVaultTarget = (tabId: string, target: string) => {
  const offer = offerOf(tabId);
  if (offer && offer.targets.includes(target)) patchOffer(tabId, offer.seq, { target, error: null });
};

export function dismissVaultOffer(tabId: string) {
  const offer = offerOf(tabId);
  if (!offer) return;
  setOffer(tabId, null);
  discard(tabId, offer.origin);
}

export async function saveVaultOffer(tabId: string) {
  const offer = offerOf(tabId);
  const web = webviews.get(tabId);
  if (!offer || offer.busy) return;
  const name = vaultProviderOf(offer.target)?.name ?? brandOf(offer.target).name;
  patchOffer(tabId, offer.seq, { busy: true, error: null });
  const result = web ? await web.saveToVault({ provider: offer.target, origin: offer.origin, title: siteLabel(offer.origin) }).catch(() => null) : null;
  if (offerOf(tabId)?.seq !== offer.seq) return;
  if (!result?.saved) return patchOffer(tabId, offer.seq, { busy: false, error: `Couldn't save to ${name}. Try again.` });
  setOffer(tabId, null);
  void loadVaultItems(offer.target, true);
  const windowId = useBrowser.getState().tabs[tabId]?.windowId;
  if (windowId) showToast(windowId, `Saved to ${name}`, undefined, { icon: "checkmark.circle.fill" });
}
