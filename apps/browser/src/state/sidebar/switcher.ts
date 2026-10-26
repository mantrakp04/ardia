import { restartSwitcherPointer, setSwitcherCapture, switcherPointerMoved } from "../../platform/focus";
import { useBrowser } from "../browser/store";
import { recentTabIds } from "../pins/organize";
import { setSidebarUi, sidebarUi } from "./sidebarUi";

const SHOW_AFTER_MS = 140;
const POINTER_POLL_MS = 50;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let pointerTimer: ReturnType<typeof setInterval> | undefined;
let hoveredRow: number | null = null;
let keyboardMoves = 0;
let pointerStale = false;

export function switcherStep(windowId: string, backward: boolean) {
  const current = sidebarUi().switcher;
  if (current && current.windowId === windowId) return moveSwitcher(backward ? -1 : 1);
  const ids = recentTabIds(useBrowser.getState(), windowId);
  if (ids.length < 2) return;
  setSidebarUi({ switcher: { windowId, ids, index: backward ? ids.length - 1 : 1, visible: false } });
  setSwitcherCapture(true);
  clearTimeout(showTimer);
  showTimer = setTimeout(() => {
    const s = sidebarUi().switcher;
    if (s) setSidebarUi({ switcher: { ...s, visible: true } });
  }, SHOW_AFTER_MS);
}

export function moveSwitcher(step: 1 | -1) {
  const s = sidebarUi().switcher;
  if (!s) return;
  focusSwitcherRow(s.index + step);
  stopPointerWatch();
  pointerStale = true;
  const move = ++keyboardMoves;
  void restartSwitcherPointer().then(() => {
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
  if (id && useBrowser.getState().tabs[id]) useBrowser.getState().activate(id);
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
  setSwitcherCapture(false);
  setSidebarUi({ switcher: null });
}
