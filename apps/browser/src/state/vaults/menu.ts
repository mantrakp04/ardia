import { create } from "zustand";
import { webviews } from "../../platform/webviews";
import { useBrowser } from "../browser/store";
import { activeTab } from "../browser/model";
import { hasMatchRow, menuRows, type MenuMode, type VaultRow } from "./menuModel";
import { isSecureOrigin } from "./originMatch";
import { pendingFor } from "./pendingTotp";
import { allVaultItems, anyVaultConnected, currentPendingTotp, currentVaultProviders, loadAllVaultItems } from "./store";
import type { VaultFieldEvent, VaultFieldKind, VaultRect } from "./types";

export type FrameId = VaultFieldEvent["frameId"];

export type VaultMenu = {
  seq: number;
  frameId: FrameId;
  origin: string;
  field: VaultFieldKind;
  rect: VaultRect | null;
  mode: MenuMode;
  query: string;
  selected: number;
  onDemand: boolean;
  error: string | null;
  busy: string | null;
  hovered: boolean;
  noTotp: string[];
};

type FieldSeen = VaultFieldEvent & { at: number };

export const useVaultMenus = create<{ menus: Record<string, VaultMenu | null>; fields: Record<string, FieldSeen | null> }>()(() => ({ menus: {}, fields: {} }));

const menus = () => useVaultMenus.getState().menus;
export const vaultMenuOf = (tabId: string) => menus()[tabId] ?? null;
export const lastVaultField = (tabId: string) => useVaultMenus.getState().fields[tabId] ?? null;

let seq = 0;
const BLUR_GRACE_MS = 100;
let pressedAt = 0;

export const noteVaultMenuPress = () => void (pressedAt = Date.now());

function closeAfterBlur(tabId: string, menuSeq: number) {
  const menu = vaultMenuOf(tabId);
  if (!menu || menu.seq !== menuSeq || menu.mode === "search" || menu.hovered || menu.busy || lastVaultField(tabId)?.focused) return;
  if (Date.now() - pressedAt <= 2 * BLUR_GRACE_MS) return;
  closeVaultMenu(tabId);
}
const otpSeenAt = new Map<string, number>();

export const otpFieldSeenSince = (origin: string, since: number) => (otpSeenAt.get(origin) ?? 0) >= since;

function setMenu(tabId: string, menu: VaultMenu | null) {
  useVaultMenus.setState((s) => ({ menus: { ...s.menus, [tabId]: menu } }));
}

export function patchVaultMenu(tabId: string, patch: Partial<VaultMenu>, onlySeq?: number) {
  const menu = vaultMenuOf(tabId);
  if (!menu || (onlySeq !== undefined && menu.seq !== onlySeq)) return;
  setMenu(tabId, { ...menu, ...patch });
}

const tellPage = (tabId: string, frameId: FrameId, open: boolean) => void webviews.get(tabId)?.setVaultMenu({ frameId, open })?.catch(() => {});

export function rowsOfMenu(menu: VaultMenu): VaultRow[] {
  return menuRows({
    field: menu.field,
    mode: menu.mode,
    origin: menu.origin,
    query: menu.query,
    providers: currentVaultProviders(),
    items: allVaultItems(),
    pending: pendingFor(currentPendingTotp(), menu.origin, Date.now()),
    noTotp: new Set(menu.noTotp),
  });
}

export function closeVaultMenu(tabId: string, refocus = false) {
  const menu = vaultMenuOf(tabId);
  if (!menu) return;
  setMenu(tabId, null);
  tellPage(tabId, menu.frameId, false);
  if (refocus && (menu.mode === "search" || lastVaultField(tabId)?.focused === false)) void webviews.get(tabId)?.focus();
}

function openMenu(tabId: string, field: FieldSeen, onDemand: boolean) {
  const old = vaultMenuOf(tabId);
  if (old && old.frameId !== field.frameId) tellPage(tabId, old.frameId, false);
  const menu: VaultMenu = {
    seq: ++seq,
    frameId: field.frameId,
    origin: field.origin,
    field: field.kind,
    rect: field.rect,
    mode: "matches",
    query: "",
    selected: -1,
    onDemand,
    error: null,
    busy: null,
    hovered: false,
    noTotp: [],
  };
  setMenu(tabId, menu);
  tellPage(tabId, field.frameId, true);
}

const suggestOnFocus = () => useBrowser.getState().settings.vaultSuggestOnFocus;

async function offerOnFocus(tabId: string, field: FieldSeen) {
  await loadAllVaultItems();
  const now = lastVaultField(tabId);
  if (now?.at !== field.at || !now.focused || vaultMenuOf(tabId)) return;
  const draft = { ...field, rect: now.rect };
  const probe: VaultMenu = { seq: 0, frameId: draft.frameId, origin: draft.origin, field: draft.kind, rect: draft.rect, mode: "matches", query: "", selected: -1, onDemand: false, error: null, busy: null, hovered: false, noTotp: [] };
  if (hasMatchRow(rowsOfMenu(probe))) openMenu(tabId, draft, false);
}

export function noteVaultField(tabId: string, event: VaultFieldEvent) {
  const previous = lastVaultField(tabId);
  const sameField = !!previous && previous.focused && previous.frameId === event.frameId && previous.kind === event.kind;
  const seen: FieldSeen = { ...event, at: sameField && event.focused ? previous.at : Date.now() };
  useVaultMenus.setState((s) => ({ fields: { ...s.fields, [tabId]: seen } }));
  const menu = vaultMenuOf(tabId);
  if (!event.focused) {
    if (menu && menu.frameId === event.frameId) setTimeout(() => closeAfterBlur(tabId, menu.seq), BLUR_GRACE_MS);
    return;
  }
  if (event.kind === "otp") otpSeenAt.set(event.origin, Date.now());
  if (menu && menu.frameId === event.frameId && menu.field === event.kind) return patchVaultMenu(tabId, { rect: event.rect, origin: event.origin });
  if (menu) closeVaultMenu(tabId);
  if (sameField || !event.main || !event.rect || !suggestOnFocus() || !anyVaultConnected() || !isSecureOrigin(event.origin)) return;
  void offerOnFocus(tabId, seen);
}

export function openVaultMenuOnDemand(tabId: string): boolean {
  const field = lastVaultField(tabId);
  if (!field || !anyVaultConnected()) return false;
  openMenu(tabId, field, true);
  void loadAllVaultItems();
  return true;
}

export const selectVaultRow = (tabId: string, selected: number) => patchVaultMenu(tabId, { selected });
export function hoverVaultMenu(tabId: string, hovered: boolean) {
  const menu = vaultMenuOf(tabId);
  if (!hovered && menu && menu.mode !== "search" && !menu.busy && lastVaultField(tabId)?.focused === false) return closeVaultMenu(tabId);
  patchVaultMenu(tabId, { hovered });
}
export const searchVaultMenu = (tabId: string, query: string) => patchVaultMenu(tabId, { query, selected: query ? 0 : -1 });
export const showAllPasswords = (tabId: string) => patchVaultMenu(tabId, { mode: "search", query: "", selected: -1, error: null });
export function showVaultMatches(tabId: string) {
  if (vaultMenuOf(tabId)?.mode === "search") void webviews.get(tabId)?.focus();
  patchVaultMenu(tabId, { mode: "matches", query: "", selected: -1, error: null });
}

export function forgetVaultPage(tabId: string) {
  closeVaultMenu(tabId);
  useVaultMenus.setState((s) => (s.fields[tabId] ? { fields: { ...s.fields, [tabId]: null } } : s));
}

export function startVaultMenus() {
  return useBrowser.subscribe((s, prev) => {
    if (s.tabs === prev.tabs && s.windows === prev.windows) return;
    for (const [tabId, menu] of Object.entries(menus())) {
      if (!menu) continue;
      const tab = s.tabs[tabId];
      if (!tab || activeTab(s, tab.windowId)?.id !== tabId) closeVaultMenu(tabId);
    }
  });
}
