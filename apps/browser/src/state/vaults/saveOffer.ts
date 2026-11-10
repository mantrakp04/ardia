import { create } from "zustand";
import type { VaultItem, VaultProviderState } from "../../platform/vaults";
import { webviews } from "../../platform/webviews";
import { showToast } from "../app/toasts";
import { useBrowser } from "../browser/store";
import { patchPage, pageOf } from "../tabs/pageState";
import { filledUsername, rememberedVaultAccount, rememberVaultAccount } from "./accounts";
import { ARDIA_PROVIDER, isArdiaProvider, itemsForTab } from "./ardia";
import { brandOf } from "./brands";
import { itemKey } from "./menuModel";
import { isSecureOrigin, loginSavedIn, sameSite, siteLabel } from "./originMatch";
import { PENDING_TOTP_MS } from "./pendingTotp";
import { allVaultItems, currentVaultProviders, loadAllVaultItems, loadVaultItems, vaultProviderOf } from "./store";
import type { VaultSubmittedEvent } from "./types";

export type VaultSaveOffer = {
  seq: number;
  origin: string;
  captured: string;
  username: string;
  editing: boolean;
  needsUsername: boolean;
  targets: string[];
  target: string;
  busy: boolean;
  error: string | null;
};

export const useVaultSaveOffers = create<Record<string, VaultSaveOffer | null>>()(() => ({}));

export const SAVE_OFFER_MS = PENDING_TOTP_MS;
export const SAME_SUBMISSION_MS = 2000;

type SaveInput = { enabled: boolean; origin: string; username: string; providers: readonly VaultProviderState[]; items: readonly VaultItem[]; preferred: string; checkSaved?: boolean };
export type SaveDecision = { offer: false; alreadySaved: boolean } | { offer: true; targets: string[]; target: string };

export const saveTargets = (providers: readonly VaultProviderState[]) => providers.filter((p) => p.state === "unlocked" && p.capabilities.save).map((p) => p.id);

export const connectedSavers = (providers: readonly VaultProviderState[]) =>
  providers.filter((p) => (p.state === "unlocked" || p.state === "locked") && p.capabilities.save);

export function preferredSaveTarget(providers: readonly VaultProviderState[], chosen: string): string {
  const connected = connectedSavers(providers).map((p) => p.id);
  if (connected.includes(chosen)) return chosen;
  const managers = connected.filter((id) => !isArdiaProvider(id));
  if (managers.length === 1) return managers[0]!;
  return !managers.length && connected.includes(ARDIA_PROVIDER) ? ARDIA_PROVIDER : "";
}

export const chooseSaveTarget = (targets: readonly string[], preferred: string) => (targets.includes(preferred) ? preferred : (targets[0] ?? ""));

export function decideSave({ enabled, origin, username, providers, items, preferred, checkSaved = true }: SaveInput): SaveDecision {
  const unlocked = new Set(providers.filter((p) => p.state === "unlocked").map((p) => p.id));
  if (checkSaved && loginSavedIn(items.filter((i) => unlocked.has(i.provider)), origin, username)) return { offer: false, alreadySaved: true };
  const targets = saveTargets(providers);
  if (!enabled || !isSecureOrigin(origin) || !targets.length) return { offer: false, alreadySaved: false };
  const wanted = preferredSaveTarget(providers, preferred);
  const target = chooseSaveTarget(targets, wanted);
  return { offer: true, targets: target === wanted ? [target] : targets, target };
}

export const FORM_USERNAME_SOURCES: ReadonlySet<string> = new Set(["form", "step"]);

export const usernameFromForm = (event: Pick<VaultSubmittedEvent, "username" | "usernameFrom">) => !!event.username.trim() && FORM_USERNAME_SOURCES.has(event.usernameFrom ?? "");

export function mayAutoSave(event: Pick<VaultSubmittedEvent, "username" | "usernameFrom" | "newPassword" | "generated" | "trusted">): boolean {
  if (!event.username.trim()) return false;
  return event.generated === true || (event.newPassword === true && event.trusted === true && usernameFromForm(event));
}

export function knownUsername(tabId: string, event: Pick<VaultSubmittedEvent, "origin" | "username">, items: readonly VaultItem[]): string {
  const typed = event.username.trim();
  if (typed) return typed;
  const remembered = rememberedVaultAccount(event.origin);
  const login = remembered ? items.find((i) => itemKey(i) === remembered) : undefined;
  return login?.username.trim() || filledUsername(tabId, event.origin).trim();
}

type Claim = { origin: string; at: number; offered: boolean };
const claims = new Map<string, Claim>();
const expiries = new Map<string, ReturnType<typeof setTimeout>>();
const recent = new Map<string, { key: string; at: number }>();
const saving = new Set<string>();
const pageLoads = new Map<string, number>();
const autoSavedOn = new Map<string, Set<string>>();
let seq = 0;

const pageLoadOf = (tabId: string) => pageLoads.get(tabId) ?? 0;

export function forgetVaultPageSaves(tabId: string) {
  pageLoads.set(tabId, pageLoadOf(tabId) + 1);
  autoSavedOn.delete(tabId);
}

const autoSaveSlot = (load: number, origin: string) => `${load}\n${origin}`;
const autoSavedAlready = (tabId: string, load: number, origin: string) => autoSavedOn.get(tabId)?.has(autoSaveSlot(load, origin)) ?? false;
function spendAutoSave(tabId: string, load: number, origin: string) {
  const used = autoSavedOn.get(tabId) ?? new Set<string>();
  used.add(autoSaveSlot(load, origin));
  autoSavedOn.set(tabId, used);
}

const savingKey = (origin: string, username: string) => `${origin}\n${username.trim().toLowerCase()}`;

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

function seenJustNow(tabId: string, event: VaultSubmittedEvent, now: number) {
  const key = [event.origin, event.username.trim().toLowerCase(), event.newPassword ? 1 : 0, event.generated ? 1 : 0].join("\n");
  const last = recent.get(tabId);
  if (last && last.key === key && now - last.at < SAME_SUBMISSION_MS) return true;
  recent.set(tabId, { key, at: now });
  return false;
}

const managerName = (id: string) => vaultProviderOf(id)?.name ?? brandOf(id).name;
const saveError = (id: string) => `Couldn't save to ${managerName(id)}. Try again.`;

function showOffer(tabId: string, origin: string, captured: string, username: string, decision: Extract<SaveDecision, { offer: true }>, error: string | null = null) {
  const old = offerOf(tabId);
  if (old && old.origin !== origin) discard(tabId, old.origin);
  const needsUsername = !username;
  setOffer(tabId, { seq: ++seq, origin, captured, username, editing: needsUsername, needsUsername, targets: decision.targets, target: decision.target, busy: false, error });
  claim(tabId, origin, true);
}

export async function noteVaultSubmitted(tabId: string, event: VaultSubmittedEvent) {
  const load = pageLoadOf(tabId);
  if (saving.has(savingKey(event.origin, event.username)) || seenJustNow(tabId, event, Date.now())) return;
  await loadAllVaultItems();
  const settings = useBrowser.getState().settings;
  const items = itemsForTab(allVaultItems(), tabId);
  const page = event.username.trim();
  const fresh = event.newPassword === true || event.generated === true;
  const base = { enabled: settings.vaultSaveOffer, origin: event.origin, providers: currentVaultProviders(), items, preferred: settings.vaultSaveTarget };
  if (!fresh) {
    const decision = decideSave({ ...base, username: page });
    if (!decision.offer) {
      if (decision.alreadySaved) claim(tabId, event.origin, false);
      return discard(tabId, event.origin);
    }
    return showOffer(tabId, event.origin, page, page, decision);
  }
  if (usernameFromForm(event)) {
    const changed = decideSave({ ...base, username: page });
    if (!changed.offer && changed.alreadySaved) {
      claim(tabId, event.origin, false);
      return discard(tabId, event.origin);
    }
  }
  const guess = knownUsername(tabId, event, items);
  const decision = decideSave({ ...base, username: guess, checkSaved: false });
  if (!decision.offer) return discard(tabId, event.origin);
  const auto =
    settings.vaultAutoSave &&
    mayAutoSave(event) &&
    decision.targets.length === 1 &&
    !autoSavedAlready(tabId, load, event.origin) &&
    decideSave({ ...base, username: page }).offer;
  if (!auto) return showOffer(tabId, event.origin, page, guess, decision);
  spendAutoSave(tabId, load, event.origin);
  claim(tabId, event.origin, true);
  const saved = await saveLogin(tabId, event.origin, decision.target, null, page);
  if (!saved) showOffer(tabId, event.origin, page, page, decision, saveError(decision.target));
}

async function saveLogin(tabId: string, origin: string, target: string, username: string | null, savedAs: string): Promise<boolean> {
  const web = webviews.get(tabId);
  const request = { provider: target, origin, title: siteLabel(origin), ...(username !== null ? { username } : {}) };
  const key = savingKey(origin, savedAs);
  saving.add(key);
  const result = web ? await web.saveToVault(request).catch(() => null) : null;
  saving.delete(key);
  if (!result?.saved) return false;
  if (result.item) rememberVaultAccount(origin, result.item);
  void loadVaultItems(target, true);
  const windowId = useBrowser.getState().tabs[tabId]?.windowId;
  if (windowId) showToast(windowId, `Saved to ${managerName(target)}`, undefined, { icon: "checkmark.circle.fill" });
  return true;
}

const patchOffer = (tabId: string, s: number, patch: Partial<VaultSaveOffer>) => {
  const offer = offerOf(tabId);
  if (offer?.seq === s) setOffer(tabId, { ...offer, ...patch });
};

export const chooseVaultTarget = (tabId: string, target: string) => {
  const offer = offerOf(tabId);
  if (offer && offer.targets.includes(target)) patchOffer(tabId, offer.seq, { target, error: null });
};

export function editVaultOfferUsername(tabId: string) {
  const offer = offerOf(tabId);
  if (offer && !offer.busy) patchOffer(tabId, offer.seq, { editing: true });
}

export function setVaultOfferUsername(tabId: string, username: string) {
  const offer = offerOf(tabId);
  if (offer && !offer.busy) patchOffer(tabId, offer.seq, { username, error: null });
}

export const canSaveVaultOffer = (offer: Pick<VaultSaveOffer, "busy" | "needsUsername" | "username">) => !offer.busy && (!offer.needsUsername || !!offer.username.trim());

export function dismissVaultOffer(tabId: string) {
  const offer = offerOf(tabId);
  if (!offer) return;
  setOffer(tabId, null);
  discard(tabId, offer.origin);
}

export async function saveVaultOffer(tabId: string) {
  const offer = offerOf(tabId);
  if (!offer || !canSaveVaultOffer(offer)) return;
  const username = offer.username.trim();
  patchOffer(tabId, offer.seq, { busy: true, error: null, username });
  const saved = await saveLogin(tabId, offer.origin, offer.target, username !== offer.captured ? username : null, offer.captured);
  if (offerOf(tabId)?.seq !== offer.seq) return;
  if (!saved) return patchOffer(tabId, offer.seq, { busy: false, error: saveError(offer.target) });
  setOffer(tabId, null);
}
