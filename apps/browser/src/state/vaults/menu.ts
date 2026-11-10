import { create } from "zustand";
import { webviews } from "../../platform/webviews";
import { useBrowser } from "../browser/store";
import { activeTabId } from "../browser/model";
import { peekTabId } from "../peek/peek";
import { splitOf, splitTabIdsOf } from "../splits/splits";
import { rememberedVaultAccount } from "./accounts";
import { refreshVaultBiometrics } from "./biometrics";
import { prefetchVaultCode } from "./codes";
import { forgetVaultPageSaves } from "./saveOffer";
import { currentGeneratedPasswords, searchGenerated } from "./generated";
import { hasFillRow, hasMatchRow, MAX_SEARCH_ROWS, menuRows, restingRow, type MenuMode, type VaultRow } from "./menuModel";
import { isSecureOrigin } from "./originMatch";
import { pendingFor } from "./pendingTotp";
import { allVaultItems, anyVaultConnected, currentPendingTotp, currentVaultProviders, loadAllVaultItems, useVaults } from "./store";
import type { VaultFieldEvent, VaultFieldKind, VaultRect } from "./types";

export type FrameId = VaultFieldEvent["frameId"];

export type VaultTouchPhase = "off" | "ready" | "retry" | "granted" | "unavailable" | "lockout";

export type VaultMenu = {
  seq: number;
  frameId: FrameId;
  origin: string;
  field: VaultFieldKind;
  rect: VaultRect | null;
  maxLength: number;
  mode: MenuMode;
  query: string;
  selected: number;
  onDemand: boolean;
  error: string | null;
  busy: string | null;
  hovered: boolean;
  hidden: boolean;
  noTotp: string[];
  remembered: string | null;
  email: boolean;
  suggestOpen: boolean;
  touch: VaultTouchPhase;
  touchRetries: number;
  touchRearms: number;
};

type FieldSeen = VaultFieldEvent & { at: number };

export const useVaultMenus = create<{ menus: Record<string, VaultMenu | null>; fields: Record<string, FieldSeen | null> }>()(() => ({ menus: {}, fields: {} }));

const menus = () => useVaultMenus.getState().menus;
export const vaultMenuOf = (tabId: string) => menus()[tabId] ?? null;
export const lastVaultField = (tabId: string) => useVaultMenus.getState().fields[tabId] ?? null;

let seq = 0;
let focusSeq = 0;
const BLUR_GRACE_MS = 100;
let pressedAt = 0;

export const noteVaultMenuPress = () => void (pressedAt = Date.now());

type Quiet = { frameId: FrameId; kind: VaultFieldKind; until: number | null };
const quiet = new Map<string, Quiet>();
const declined = new Map<string, number>();
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

const declinedNow = (tabId: string, field: FieldSeen) => declined.get(tabId) === field.at;

function setMenu(tabId: string, menu: VaultMenu | null) {
  useVaultMenus.setState((s) => ({ menus: { ...s.menus, [tabId]: menu } }));
}

const told = new Map<string, { frameId: FrameId; open: boolean; highlighted: boolean }>();

function tellPage(tabId: string, frameId: FrameId, open: boolean, highlighted = false) {
  told.set(tabId, { frameId, open, highlighted: open && highlighted });
  const sent = webviews.get(tabId)?.setVaultMenu({ frameId, open, highlighted });
  void sent?.catch(() => {
    const menu = vaultMenuOf(tabId);
    const last = told.get(tabId);
    if (!open || !menu || menu.frameId !== frameId || last?.frameId !== frameId || !last.open) return;
    void webviews.get(tabId)?.setVaultMenu({ frameId, open: last.open, highlighted: last.highlighted })?.catch(() => closeVaultMenu(tabId));
  });
}

const tellPageOfMenu = (tabId: string, menu: VaultMenu) => tellPage(tabId, menu.frameId, !menu.hidden, !menu.hidden && menu.selected >= 0);

export function resyncVaultPage(tabId: string, frameId: FrameId) {
  const menu = vaultMenuOf(tabId);
  if (menu && menu.frameId === frameId) return tellPageOfMenu(tabId, menu);
  tellPage(tabId, frameId, false);
}

export function patchVaultMenu(tabId: string, patch: Partial<VaultMenu>, onlySeq?: number) {
  const menu = vaultMenuOf(tabId);
  if (!menu || (onlySeq !== undefined && menu.seq !== onlySeq)) return;
  const next = { ...menu, ...patch };
  setMenu(tabId, next);
  if (next.hidden !== menu.hidden || (!next.hidden && next.selected !== menu.selected)) tellPageOfMenu(tabId, next);
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
    remembered: menu.remembered,
    email: menu.email,
    generated: menu.mode === "search" ? searchGenerated(currentGeneratedPasswords(), menu.query, MAX_SEARCH_ROWS) : [],
    suggestOpen: menu.suggestOpen,
  });
}

export const restingRowOf = (menu: VaultMenu) => restingRow(rowsOfMenu(menu), menu.remembered);

export function closeVaultMenu(tabId: string, refocus = false) {
  const menu = vaultMenuOf(tabId);
  if (!menu) return;
  setMenu(tabId, null);
  tellPage(tabId, menu.frameId, false);
  if (refocus && (menu.mode === "search" || lastVaultField(tabId)?.focused === false)) void webviews.get(tabId)?.focus();
}

export function dismissVaultMenu(tabId: string, refocus = false) {
  const field = lastVaultField(tabId);
  if (field?.focused) declined.set(tabId, field.at);
  closeVaultMenu(tabId, refocus);
}

const blankMenu = (field: FieldSeen, onDemand: boolean): VaultMenu => ({
  seq: 0,
  frameId: field.frameId,
  origin: field.origin,
  field: field.kind,
  rect: field.rect,
  maxLength: field.maxLength ?? 0,
  mode: "matches",
  query: "",
  selected: -1,
  onDemand,
  error: null,
  busy: null,
  hovered: false,
  hidden: false,
  noTotp: [],
  remembered: rememberedVaultAccount(field.origin),
  email: !!field.email,
  suggestOpen: false,
  touch: "off",
  touchRetries: 0,
  touchRearms: 0,
});

function openMenu(tabId: string, field: FieldSeen, onDemand: boolean) {
  const old = vaultMenuOf(tabId);
  if (old && old.frameId !== field.frameId) tellPage(tabId, old.frameId, false);
  const menu: VaultMenu = { ...blankMenu(field, onDemand), seq: ++seq };
  const resting = restingRowOf(menu);
  const opened = { ...menu, selected: resting };
  setMenu(tabId, opened);
  tellPageOfMenu(tabId, opened);
  refreshVaultBiometrics();
  prefetchCodesOf(opened);
}

export function prefetchCodesOf(menu: VaultMenu) {
  if (menu.field !== "otp") return;
  for (const row of rowsOfMenu(menu)) if (row.kind === "otp") prefetchVaultCode(row.item);
}

const suggestOnFocus = () => useBrowser.getState().settings.vaultSuggestOnFocus;

const canOffer = (field: FieldSeen | null): field is FieldSeen => !!field?.focused && !!field.rect && isSecureOrigin(field.origin) && anyVaultConnected();

async function offerOnFocus(tabId: string, field: FieldSeen) {
  await loadAllVaultItems();
  const now = lastVaultField(tabId);
  if (!canOffer(now) || now.at !== field.at || vaultMenuOf(tabId) || declinedNow(tabId, now) || !now.main || !suggestOnFocus()) return;
  if (isQuiet(tabId, now)) return;
  if (hasMatchRow(rowsOfMenu(blankMenu(now, false)))) openMenu(tabId, now, false);
}

function openOnDemand(tabId: string, field: FieldSeen) {
  quiet.delete(tabId);
  declined.delete(tabId);
  if (!canOffer(field)) return false;
  const menu = vaultMenuOf(tabId);
  if (menu && menu.frameId === field.frameId && menu.field === field.kind) {
    tellPageOfMenu(tabId, menu);
    return true;
  }
  openMenu(tabId, field, true);
  void loadAllVaultItems();
  return true;
}

export function noteVaultField(tabId: string, event: VaultFieldEvent) {
  const previous = lastVaultField(tabId);
  const sameField = !!previous && previous.focused && previous.frameId === event.frameId && previous.kind === event.kind;
  const seen: FieldSeen = { ...event, at: sameField && event.focused ? previous.at : ++focusSeq };
  useVaultMenus.setState((s) => ({ fields: { ...s.fields, [tabId]: seen } }));
  const menu = vaultMenuOf(tabId);
  if (!event.focused) {
    if (menu && menu.frameId === event.frameId) setTimeout(() => closeAfterBlur(tabId, menu.seq), BLUR_GRACE_MS);
    return;
  }
  if (menu && menu.frameId === event.frameId && menu.field === event.kind) {
    patchVaultMenu(tabId, { rect: event.rect, origin: event.origin, maxLength: event.maxLength ?? menu.maxLength });
    if (!sameField || event.clicked) tellPageOfMenu(tabId, vaultMenuOf(tabId)!);
    return;
  }
  if (menu) closeVaultMenu(tabId);
  if (event.clicked) return void openOnDemand(tabId, seen);
  if (sameField || isQuiet(tabId, event)) return;
  if (!event.main || !canOffer(seen) || !suggestOnFocus()) return;
  void offerOnFocus(tabId, seen);
}

function closeAfterBlur(tabId: string, menuSeq: number) {
  const menu = vaultMenuOf(tabId);
  if (!menu || menu.seq !== menuSeq || menu.mode === "search" || menu.hovered || menu.busy || lastVaultField(tabId)?.focused) return;
  if (Date.now() - pressedAt <= 2 * BLUR_GRACE_MS) return;
  closeVaultMenu(tabId);
}

export function openVaultMenuOnDemand(tabId: string): boolean {
  const field = lastVaultField(tabId);
  return !!field && openOnDemand(tabId, field);
}

export function reopenVaultMenuFromKey(tabId: string, frameId: FrameId): boolean {
  const field = lastVaultField(tabId);
  if (!field || field.frameId !== frameId) return false;
  return openOnDemand(tabId, field);
}

type GeneratedFill = { frameId: FrameId; origin: string; kind: VaultFieldKind };
const generatedFills = new Map<string, GeneratedFill>();

export const noteGeneratedFill = (tabId: string, frameId: FrameId, origin: string, kind: VaultFieldKind) => void generatedFills.set(tabId, { frameId, origin, kind });

export function noteVaultFieldCleared(tabId: string, frameId: FrameId) {
  const generated = generatedFills.get(tabId);
  const abandoned = !!generated && generated.frameId === frameId && lastVaultField(tabId)?.kind === generated.kind;
  if (generated && abandoned) {
    generatedFills.delete(tabId);
    void webviews.get(tabId)?.discardVaultCapture({ origin: generated.origin })?.catch(() => {});
  }
  const menu = vaultMenuOf(tabId);
  if (menu && menu.frameId === frameId) return;
  if (abandoned) return void reopenVaultMenuFromKey(tabId, frameId);
  offerVaultMenuAgain(tabId, frameId);
}

export function offerVaultMenuAgain(tabId: string, frameId: FrameId) {
  const field = lastVaultField(tabId);
  if (!field || field.frameId !== frameId || vaultMenuOf(tabId)) return;
  quiet.delete(tabId);
  declined.delete(tabId);
  if (canOffer(field) && field.main && suggestOnFocus()) void offerOnFocus(tabId, field);
}

export function setVaultMenuOffscreen(tabId: string, menuSeq: number, offscreen: boolean) {
  const menu = vaultMenuOf(tabId);
  if (menu?.seq === menuSeq && menu.hidden !== offscreen) patchVaultMenu(tabId, { hidden: offscreen, hovered: offscreen ? false : menu.hovered }, menuSeq);
}

export const selectVaultRow = (tabId: string, selected: number) => patchVaultMenu(tabId, { selected });
export function hoverVaultMenu(tabId: string, hovered: boolean) {
  const menu = vaultMenuOf(tabId);
  if (!hovered && menu && menu.mode !== "search" && !menu.busy && lastVaultField(tabId)?.focused === false) return closeVaultMenu(tabId);
  if (!hovered && menu && menu.mode === "matches" && !menu.busy) return patchVaultMenu(tabId, { hovered, selected: restingRowOf(menu) });
  patchVaultMenu(tabId, { hovered });
}
export const searchVaultMenu = (tabId: string, query: string) => patchVaultMenu(tabId, { query, selected: query ? 0 : -1 });
export function setVaultSuggestOpen(tabId: string, open: boolean) {
  const menu = vaultMenuOf(tabId);
  if (!menu || menu.mode !== "matches") return;
  const rows = rowsOfMenu({ ...menu, suggestOpen: open });
  const selected = open ? rows.findIndex((r) => r.kind === "generate") : rows.findIndex((r) => r.kind === "suggest");
  patchVaultMenu(tabId, { suggestOpen: open, selected, error: null });
}
export const showAllPasswords = (tabId: string) => patchVaultMenu(tabId, { mode: "search", query: "", selected: -1, error: null });
export function showVaultMatches(tabId: string) {
  const menu = vaultMenuOf(tabId);
  if (!menu) return;
  if (menu.mode === "search") void webviews.get(tabId)?.focus();
  const matches = { ...menu, mode: "matches" as const, query: "" };
  patchVaultMenu(tabId, { mode: "matches", query: "", selected: restingRowOf(matches), error: null });
}

export function noteAutofillSuggestions(tabId: string, count: number) {
  const menu = vaultMenuOf(tabId);
  if (count <= 0 || !menu || menu.onDemand || menu.busy || hasFillRow(rowsOfMenu(menu))) return;
  dismissVaultMenu(tabId);
}

export function forgetVaultPage(tabId: string) {
  closeVaultMenu(tabId);
  forgetVaultPageSaves(tabId);
  generatedFills.delete(tabId);
  quiet.delete(tabId);
  declined.delete(tabId);
  told.delete(tabId);
  useVaultMenus.setState((s) => (s.fields[tabId] ? { fields: { ...s.fields, [tabId]: null } } : s));
}

function shownTabIds(s: ReturnType<typeof useBrowser.getState>, windowId: string): string[] {
  const active = activeTabId(s, windowId);
  const peek = peekTabId(s, windowId);
  return [...(peek ? [peek] : []), ...(active ? (splitTabIdsOf(splitOf(s, active)) ?? [active]) : [])];
}

const isShown = (tabId: string) => {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  return !!tab && shownTabIds(s, tab.windowId).includes(tabId);
};

export function offerToFocusedField(tabId: string) {
  const field = lastVaultField(tabId);
  if (!canOffer(field) || !field.main || !suggestOnFocus() || vaultMenuOf(tabId) || declinedNow(tabId, field) || isQuiet(tabId, field) || !isShown(tabId)) return;
  void offerOnFocus(tabId, field);
}

const unlockedCount = (s: ReturnType<typeof useVaults.getState>) => s.providers.filter((p) => p.state === "unlocked").length;

function offerToFocusedFields() {
  for (const tabId of Object.keys(useVaultMenus.getState().fields)) offerToFocusedField(tabId);
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
  const readyManagers = (s: ReturnType<typeof useVaults.getState>) => s.providers.filter((p) => p.state === "locked" || (p.state === "unlocked" && p.id in s.items)).length;
  const stopVaults = useVaults.subscribe((s, prev) => {
    if (readyManagers(s) > readyManagers(prev) || unlockedCount(s) > unlockedCount(prev)) offerToFocusedFields();
  });
  return () => {
    stopTabs();
    stopVaults();
  };
}
