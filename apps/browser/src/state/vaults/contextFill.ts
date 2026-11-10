import { setVaultContextMenuOptions } from "../../platform/pageOptions";
import type { VaultContextAction, VaultContextField, VaultItem } from "../../platform/vaults";
import { webviews } from "../../platform/webviews";
import { showToast } from "../app/toasts";
import { useBrowser } from "../browser/store";
import { noteFilledUsername, rememberedVaultAccount, rememberVaultAccount } from "./accounts";
import { openPasswordSettings, unlockProvider } from "./actions";
import { itemsForTab } from "./ardia";
import { contextLoginKey, contextMenuModel, contextMenuOptions, fillFieldOf, menuFieldOf, pickedFillFields } from "./contextMenuModel";
import { CONTEXT_TARGET, forgetContextPick, markContextPick } from "./contextTarget";
import { fillErrorText } from "./fill";
import { currentVaultSuggest, noteVaultField, showAllPasswords, vaultMenuOf } from "./menu";
import { allVaultItems, anyVaultConnected, currentVaultProviders, loadAllVaultItems, loadVaultItems, useVaults } from "./store";

const contexts = new Map<string, VaultContextField>();

const TOAST = { icon: "key", key: "vaultContext" } as const;
const FAILED_ICON = { icon: "exclamationmark.circle", key: "vaultContext" } as const;

function toast(tabId: string, title: string, failed = false) {
  const windowId = useBrowser.getState().tabs[tabId]?.windowId;
  if (windowId) showToast(windowId, title, undefined, failed ? FAILED_ICON : TOAST);
}

const isCurrent = (tabId: string, field: VaultContextField) => contexts.get(tabId) === field;

function sendMenu(tabId: string, field: VaultContextField) {
  const menu = contextMenuModel({
    origin: field.origin,
    providers: currentVaultProviders(),
    items: itemsForTab(allVaultItems(), tabId),
    remembered: rememberedVaultAccount(field.origin),
    suggest: currentVaultSuggest(),
  });
  void webviews.get(tabId)?.setVaultContextMenu({ frameId: field.frameId, origin: field.origin, menu })?.catch(() => undefined);
}

export function noteVaultContext(tabId: string, field: VaultContextField) {
  contexts.set(tabId, field);
  sendMenu(tabId, field);
  if (!anyVaultConnected()) return;
  void loadAllVaultItems().then(() => isCurrent(tabId, field) && sendMenu(tabId, field));
}

const itemOf = (tabId: string, key: string): VaultItem | undefined => itemsForTab(allVaultItems(), tabId).find((item) => contextLoginKey(item) === key);

async function fillChoice(tabId: string, field: VaultContextField, action: Extract<VaultContextAction, { action: "fill" }>) {
  const item = itemOf(tabId, action.login);
  const web = webviews.get(tabId);
  if (!item || !web) return toast(tabId, "This login is no longer in your password manager.", true);
  const request = {
    frameId: field.frameId,
    origin: field.origin,
    provider: item.provider,
    id: item.id,
    fields: [fillFieldOf(action.field)],
    userChose: true,
    submit: false,
    target: CONTEXT_TARGET,
  };
  const result = await web.fillFromVault(request).catch(() => ({ filled: [], error: "failed" as const }));
  if (result.error === "notAuthorized") return;
  if (result.error) {
    if (result.error === "locked" || result.error === "notFound") void loadVaultItems(item.provider, true);
    return toast(tabId, fillErrorText(result.error, item.provider), true);
  }
  if (!result.filled.length) return toast(tabId, "Couldn't fill this field. Try again.", true);
  rememberVaultAccount(field.origin, item);
  if (action.field === "username") noteFilledUsername(tabId, field.origin, item.username);
}

async function fillGenerated(tabId: string, field: VaultContextField, action: Extract<VaultContextAction, { action: "generate" }>) {
  const web = webviews.get(tabId);
  const request = {
    frameId: field.frameId,
    origin: field.origin,
    style: action.style,
    target: CONTEXT_TARGET,
    ...(field.maxLength > 0 ? { maxLength: field.maxLength } : {}),
  };
  const result = web ? await web.fillGeneratedPassword(request).catch(() => null) : null;
  if (!result?.filled.length) toast(tabId, "Couldn't fill a password here. Try again.", true);
}

function openPicker(tabId: string, field: VaultContextField, search: boolean) {
  if (!field.rect) return toast(tabId, search ? "Other Passwords isn't available in this frame." : "Unlocked. Right-click the field again to choose a login.");
  noteVaultField(tabId, {
    frameId: field.frameId,
    origin: field.origin,
    main: field.main,
    kind: menuFieldOf(field),
    focused: true,
    rect: field.rect,
    formHasPassword: false,
    clicked: true,
    maxLength: field.maxLength,
  });
  const menu = vaultMenuOf(tabId);
  if (!menu || menu.frameId !== field.frameId) return;
  markContextPick(tabId, menu.seq, pickedFillFields(field));
  if (search) showAllPasswords(tabId);
}

async function unlockThenPick(tabId: string, field: VaultContextField) {
  const locked = currentVaultProviders().find((p) => p.state === "locked");
  if (!locked) return openPicker(tabId, field, false);
  const result = await unlockProvider(locked.id, null);
  if (!result.ok) {
    if (result.needs === "password") return openPasswordSettings();
    return toast(tabId, `Couldn't unlock ${locked.name}. Try again.`, true);
  }
  await loadAllVaultItems(true);
  if (isCurrent(tabId, field)) openPicker(tabId, field, false);
}

export function runVaultContextAction(tabId: string, action: VaultContextAction) {
  const field = contexts.get(tabId);
  if (!field || field.frameId !== action.frameId || field.origin !== action.origin) return;
  switch (action.action) {
    case "fill":
      return void fillChoice(tabId, field, action);
    case "generate":
      return void fillGenerated(tabId, field, action);
    case "other":
      return openPicker(tabId, field, true);
    case "unlock":
      return void unlockThenPick(tabId, field);
  }
}

export function startVaultContextMenu() {
  let sent = "";
  const push = () => {
    const options = contextMenuOptions(currentVaultSuggest(), useBrowser.getState().settings.vaultContextGenerate);
    const key = JSON.stringify(options);
    if (key === sent) return;
    sent = key;
    void setVaultContextMenuOptions(options).catch(() => {
      sent = "";
    });
  };
  push();
  const stopVaults = useVaults.subscribe((s, prev) => s.providers !== prev.providers && push());
  const stopBrowser = useBrowser.subscribe((s, prev) => {
    if (s.settings !== prev.settings) push();
    if (s.tabs === prev.tabs) return;
    for (const tabId of contexts.keys()) {
      if (s.tabs[tabId]) continue;
      contexts.delete(tabId);
      forgetContextPick(tabId);
    }
  });
  return () => {
    stopVaults();
    stopBrowser();
  };
}
