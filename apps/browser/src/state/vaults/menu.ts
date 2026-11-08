import { create } from "zustand";
import { webviews } from "../../platform/webviews";
import { useBrowser } from "../browser/store";
import { activeTabId } from "../browser/model";
import { peekTabId } from "../peek/peek";
import { splitOf, splitTabIdsOf } from "../splits/splits";
import { refreshVaultBiometrics } from "./biometrics";
import { hasMatchRow, menuRows, type MenuMode, type VaultRow } from "./menuModel";
import { isSecureOrigin } from "./originMatch";
import { pendingFor } from "./pendingTotp";
import { allVaultItems, anyVaultConnected, currentPendingTotp, currentVaultProviders, loadAllVaultItems, useVaults } from "./store";
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

type Quiet = { frameId: FrameId; kind: VaultFieldKind; until: number | null };
const quiet = new Map<string, Quiet>();
export const AFTER_FILL_QUIET_MS = 1500;

export function quietVaultField(tabId: string, menu: Pick<VaultMenu, "frameId" | "field">, forMs: number | null) {
  quiet.set(tabId, { frameId: menu.frameId, kind: menu.field, until: forMs === null ? null : Date.now() + forMs });
}

function isQuiet(tabId: string, event: Pick<VaultFieldEvent, "frameId" | "kind">) {
  const hush = quiet.get(tabId);
  if (!hush) return false;
  const same = hush.frameId === event.frameId && hush.kind === event.kind;
  if (!same || (hush.until !== null && Date.now() > hush.until)) {
    quiet.delete(tabId);
    return false;
  }
  return true;
}

export const otpFieldSeenSince = (origin: string, since: number) => (otpSeenAt.get(origin) ?? 0) >= since;

function setMenu(tabId: string, menu: VaultMenu | null) {
  useVaultMenus.setState((s) => ({ menus: { ...s.menus, [tabId]: menu } }));
}

const tellPage = (tabId: string, frameId: FrameId, open: boolean, highlighted = false) =>
  void webviews.get(tabId)?.setVaultMenu({ frameId, open, highlighted })?.catch(() => {});

export function patchVaultMenu(tabId: string, patch: Partial<VaultMenu>, onlySeq?: number) {
  const menu = vaultMenuOf(tabId);
  if (!menu || (onlySeq !== undefined && menu.seq !== onlySeq)) return;
  const next = { ...menu, ...patch };
  setMenu(tabId, next);
  if (next.selected !== menu.selected) tellPage(tabId, next.frameId, true, next.selected >= 0);
}

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
  const resting = restingRow(rowsOfMenu(menu));
  setMenu(tabId, { ...menu, selected: resting });
  tellPage(tabId, field.frameId, true, resting >= 0);
  refreshVaultBiometrics();
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
  if (menu && menu.frameId === event.frameId && menu.field === event.kind) {
    patchVaultMenu(tabId, { rect: event.rect, origin: event.origin });
    return tellPage(tabId, menu.frameId, true, menu.selected >= 0);
  }
  if (menu) closeVaultMenu(tabId);
  const clicked = event.clicked === true;
  if (clicked) quiet.delete(tabId);
  else if (isQuiet(tabId, event)) return;
  if ((sameField && !clicked) || !event.main || !event.rect || !suggestOnFocus() || !anyVaultConnected() || !isSecureOrigin(event.origin)) return;
  void offerOnFocus(tabId, seen);
}

export function openVaultMenuOnDemand(tabId: string): boolean {
  const field = lastVaultField(tabId);
  if (!field?.focused || !field.rect || !anyVaultConnected()) return false;
  openMenu(tabId, field, true);
  void loadAllVaultItems();
  return true;
}

export function restingRow(rows: readonly VaultRow[]) {
  const fill = rows.findIndex((r) => r.kind === "login" || r.kind === "otp");
  return fill >= 0 ? fill : rows.findIndex((r) => r.kind === "unlock");
}

export const selectVaultRow = (tabId: string, selected: number) => patchVaultMenu(tabId, { selected });
export function hoverVaultMenu(tabId: string, hovered: boolean) {
  const menu = vaultMenuOf(tabId);
  if (!hovered && menu && menu.mode !== "search" && !menu.busy && lastVaultField(tabId)?.focused === false) return closeVaultMenu(tabId);
  if (!hovered && menu && menu.mode === "matches" && !menu.busy) return patchVaultMenu(tabId, { hovered, selected: restingRow(rowsOfMenu(menu)) });
  patchVaultMenu(tabId, { hovered });
}
export const searchVaultMenu = (tabId: string, query: string) => patchVaultMenu(tabId, { query, selected: query ? 0 : -1 });
export const showAllPasswords = (tabId: string) => patchVaultMenu(tabId, { mode: "search", query: "", selected: -1, error: null });
export function showVaultMatches(tabId: string) {
  const menu = vaultMenuOf(tabId);
  if (!menu) return;
  if (menu.mode === "search") void webviews.get(tabId)?.focus();
  const matches = { ...menu, mode: "matches" as const, query: "" };
  patchVaultMenu(tabId, { mode: "matches", query: "", selected: restingRow(rowsOfMenu(matches)), error: null });
}

export function noteAutofillSuggestions(tabId: string, count: number) {
  const menu = vaultMenuOf(tabId);
  if (count > 0 && menu && !menu.onDemand) closeVaultMenu(tabId);
}

export function forgetVaultPage(tabId: string) {
  closeVaultMenu(tabId);
  quiet.delete(tabId);
  useVaultMenus.setState((s) => (s.fields[tabId] ? { fields: { ...s.fields, [tabId]: null } } : s));
}

function shownTabIds(s: ReturnType<typeof useBrowser.getState>, windowId: string): string[] {
  const active = activeTabId(s, windowId);
  const peek = peekTabId(s, windowId);
  return [...(peek ? [peek] : []), ...(active ? (splitTabIdsOf(splitOf(s, active)) ?? [active]) : [])];
}

function offerToFocusedFields() {
  if (!suggestOnFocus() || !anyVaultConnected()) return;
  for (const [tabId, field] of Object.entries(useVaultMenus.getState().fields)) {
    if (!field?.focused || !field.main || !field.rect || vaultMenuOf(tabId) || isQuiet(tabId, field) || !isSecureOrigin(field.origin)) continue;
    void offerOnFocus(tabId, field);
  }
}

export function startVaultMenus() {
  const stopTabs = useBrowser.subscribe((s, prev) => {
    if (s.tabs === prev.tabs && s.windows === prev.windows && s.splits === prev.splits) return;
    for (const [tabId, menu] of Object.entries(menus())) {
      if (!menu) continue;
      const tab = s.tabs[tabId];
      if (!tab || !shownTabIds(s, tab.windowId).includes(tabId)) closeVaultMenu(tabId);
    }
  });
  const unlockedCount = () => useVaults.getState().providers.filter((p) => p.state === "unlocked").length;
  let unlocked = unlockedCount();
  const stopVaults = useVaults.subscribe(() => {
    const now = unlockedCount();
    if (now > unlocked) offerToFocusedFields();
    unlocked = now;
  });
  return () => {
    stopTabs();
    stopVaults();
  };
}
