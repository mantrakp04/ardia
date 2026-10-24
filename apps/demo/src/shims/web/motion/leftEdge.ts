import { emitNativeEvent, provideNativeModule } from "../../expo-modules-core";
import { currentPointer, watchPointer, type PointerSample } from "./pointer";

const REACH = 24;
const WINDOW_SELECTOR = ".ardia-window";

const watched = new Map<string, number>();
const over = new Set<string>();
const unreported = new Set<string>();
const rightEdges = new Set<string>();
let stopWatching: (() => void) | null = null;

const windowFrame = () => document.querySelector<HTMLElement>(WINDOW_SELECTOR)?.getBoundingClientRect() ?? null;

function isOver(pointer: PointerSample | null, hold: number, right: boolean) {
  const frame = windowFrame();
  if (!frame || !pointer || document.fullscreenElement) return false;
  const x = pointer.clientX;
  const y = pointer.clientY;
  if (y < frame.top || y >= frame.bottom) return false;
  if (right) return isOverRight(frame, x, hold);
  if (x >= frame.left && x < frame.left + hold) return true;
  if (!(x < frame.left && x >= Math.max(0, frame.left - REACH))) return false;
  return document.hasFocus() || frame.left <= REACH;
}

function isOverRight(frame: DOMRect, x: number, hold: number) {
  const screenRight = document.documentElement.clientWidth;
  if (x < frame.right && x >= frame.right - hold) return true;
  if (!(x >= frame.right && x < Math.min(screenRight, frame.right + REACH))) return false;
  return document.hasFocus() || screenRight - frame.right <= REACH;
}

function check(pointer: PointerSample | null = currentPointer()) {
  const frame = windowFrame();
  for (const [id, hold] of [...watched]) {
    if (!watched.has(id)) continue;
    const right = rightEdges.has(id);
    const now = isOver(pointer, hold, right);
    const fresh = unreported.delete(id);
    if (!fresh && now === over.has(id)) continue;
    if (now) over.add(id);
    else over.delete(id);
    const x = pointer?.clientX ?? -1;
    const y = pointer?.clientY ?? -1;
    const point: [number, number] = frame ? [x - frame.left, y - frame.top] : [x, y];
    emitNativeEvent("ArdiaShell", "onWindowEvent", { type: right ? "rightEdge" : "leftEdge", id, over: now, point });
  }
}

const HOLDING_CLASS = "ardia-pointer-hold";

function holdPagePointer() {
  const holding = [...watched.values()].some((hold) => hold > 0);
  if (holding && !document.getElementById(HOLDING_CLASS)) {
    const style = document.createElement("style");
    style.id = HOLDING_CLASS;
    style.textContent = `.${HOLDING_CLASS} iframe { pointer-events: none !important; }`;
    document.head.append(style);
  }
  document.documentElement.classList.toggle(HOLDING_CLASS, holding);
}

function listen(on: boolean) {
  if (on === !!stopWatching) return;
  if (on) stopWatching = watchPointer(check);
  else {
    stopWatching?.();
    stopWatching = null;
  }
}

export function watchLeftEdge(id: string, on: boolean, hold: number, right = false) {
  if (on && right) rightEdges.add(id);
  else rightEdges.delete(id);
  if (on) {
    watched.set(id, Math.max(0, hold));
    unreported.add(id);
  } else {
    watched.delete(id);
    over.delete(id);
  }
  listen(watched.size > 0);
  holdPagePointer();
  if (watched.size) check();
}

provideNativeModule("ArdiaShell", {
  watchLeftEdge: async (id: string, on: boolean, hold: number) => watchLeftEdge(id, on, hold),
  watchRightEdge: async (id: string, on: boolean, hold: number) => watchLeftEdge(id, on, hold, true),
});
