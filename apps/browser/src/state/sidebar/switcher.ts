import { setSwitcherCapture, switcherPointerMoved } from "../../platform/focus";
import { useBrowser } from "../browser/store";
import { activeTabId, viewTabIds } from "../browser/model";
import { isPageUnloaded } from "../pins/pinShare";
import { sessionTabIds } from "../pins/tabCleanup";
import { tabEngine } from "../engines/engines";
import { isAsleep } from "../tabs/pageSession";
import { rememberPicture } from "../tabs/tabPictures";
import { noteTabSwitcherOpened } from "../telemetry/usage";
import { noteTabSwitcherOpenedInWebKit } from "../telemetry/tabSwitcherOpens";
import { setSidebarUi, sidebarUi } from "./sidebarUi";

const SHOW_AFTER_MS = 140;
const SESSION_START = Date.now();
const POINTER_POLL_MS = 50;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let pointerTimer: ReturnType<typeof setInterval> | undefined;
let hoveredRow: number | null = null;
let keyboardMoves = 0;
let pointerStale = false;

export function switcherStep(windowId: string, backward: boolean) {
  const current = sidebarUi().switcher;
  if (current && current.windowId === windowId) return moveSwitcher(backward ? -1 : 1);
  const s = useBrowser.getState();
  const ids = sessionTabIds(s, windowId, SESSION_START);
  if (ids.length < 2) return;
  noteTabSwitcherOpened(viewTabIds(s, windowId).filter((id) => isAsleep(s.tabs[id])).length, ids.slice(0, 2).filter((id) => s.tabs[id]!.unseen).length);
  const from = activeTabId(s, windowId);
  if (from) void rememberPicture(from);
  if (from && tabEngine(s, from) === "webkit") noteTabSwitcherOpenedInWebKit();
  setSidebarUi({ switcher: { windowId, ids, index: backward ? ids.length - 1 : 1, visible: false } });
  void setSwitcherCapture(true);
  clearTimeout(showTimer);
  showTimer = setTimeout(() => {
    const s = sidebarUi().switcher;
    if (s) setSidebarUi({ switcher: { ...s, visible: true } });
  }, SHOW_AFTER_MS);
}

function syncSwitcherTabs(windowId: string, state = useBrowser.getState()) {
  const s = sidebarUi().switcher;
  if (!s || s.windowId !== windowId) return;
  const inWindow = new Set(viewTabIds(state, windowId));
  const ids = s.ids.filter((id) => {
    const tab = state.tabs[id];
    return !!tab && inWindow.has(id) && !isAsleep(tab) && !isPageUnloaded(state, id);
  });
  if (ids.length === s.ids.length) return;
  if (ids.length < 2) return endSwitcher();
  const selected = s.ids[s.index];
  const selectedIndex = selected ? ids.indexOf(selected) : -1;
  stopPointerWatch();
  hoveredRow = null;
  pointerStale = false;
  keyboardMoves++;
  setSidebarUi({ switcher: { ...s, ids, index: selectedIndex >= 0 ? selectedIndex : Math.min(s.index, ids.length - 1) } });
}

export function subscribeSwitcherTabChanges(windowId: string) {
  syncSwitcherTabs(windowId);
  return useBrowser.subscribe((state, previous) => {
    if (state.tabs !== previous.tabs || state.windows !== previous.windows) syncSwitcherTabs(windowId, state);
  });
}

export function moveSwitcher(step: 1 | -1) {
  const s = sidebarUi().switcher;
  if (!s) return;
  focusSwitcherRow(s.index + step);
  stopPointerWatch();
  pointerStale = true;
  const move = ++keyboardMoves;
  void setSwitcherCapture(true).then(() => {
    if (move !== keyboardMoves || !sidebarUi().switcher) return;
    pointerStale = false;
    if (hoveredRow !== null) watchPointer();
  });
}

export function focusSwitcherRow(index: number) {
  const s = sidebarUi().switcher;
  if (!s) return;
  const n = s.ids.length;
  setSidebarUi({ switcher: { ...s, index: (index + n) % n } });
}

export function hoverSwitcherRow(index: number) {
  hoveredRow = index;
  if (pointerStale) return;
  if (switcherPointerMoved()) {
    stopPointerWatch();
    return focusSwitcherRow(index);
  }
  watchPointer();
}

function watchPointer() {
  pointerTimer ??= setInterval(() => {
    if (!sidebarUi().switcher || hoveredRow === null) return stopPointerWatch();
    if (!switcherPointerMoved()) return;
    const row = hoveredRow;
    stopPointerWatch();
    focusSwitcherRow(row);
  }, POINTER_POLL_MS);
}

export function leaveSwitcherRow(index: number) {
  if (hoveredRow === index) hoveredRow = null;
}

function stopPointerWatch() {
  clearInterval(pointerTimer);
  pointerTimer = undefined;
}

export function commitSwitcher(index?: number) {
  const s = sidebarUi().switcher;
  if (!s) return;
  const pointed = s.visible && !pointerStale && hoveredRow !== null && hoveredRow < s.ids.length && switcherPointerMoved() ? hoveredRow : null;
  endSwitcher();
  const id = s.ids[index ?? pointed ?? s.index];
  const state = useBrowser.getState();
  if (!id || !viewTabIds(state, s.windowId).includes(id)) return;
  if (isAsleep(state.tabs[id]) || isPageUnloaded(state, id)) return;
  if (id !== activeTabId(state, s.windowId)) state.activate(id);
}

export function cancelSwitcher() {
  if (sidebarUi().switcher) endSwitcher();
}

function endSwitcher() {
  clearTimeout(showTimer);
  stopPointerWatch();
  hoveredRow = null;
  pointerStale = false;
  keyboardMoves++;
  void setSwitcherCapture(false);
  setSidebarUi({ switcher: null });
}
