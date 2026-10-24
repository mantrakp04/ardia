import { emitNativeEvent, provideNativeModule } from "../../expo-modules-core";
import { currentPointer, watchPointer, type PointerSample } from "./pointer";

const REACH = 24;
const WINDOW_SELECTOR = ".ardia-window";

const watched = new Map<string, { hold: number; right: boolean }>();
const over = new Set<string>();
const unreported = new Set<string>();
let stopWatching: (() => void) | null = null;

const windowFrame = () => document.querySelector<HTMLElement>(WINDOW_SELECTOR)?.getBoundingClientRect() ?? null;

function isOver(pointer: PointerSample | null, { hold, right }: { hold: number; right: boolean }) {
  const frame = windowFrame();
  if (!frame || !pointer || document.fullscreenElement) return false;
  const x = pointer.clientX;
  const y = pointer.clientY;
  if (y < frame.top || y >= frame.bottom) return false;
  const screen = document.documentElement.clientWidth;
  if (right ? x >= frame.right - hold && x < frame.right : x >= frame.left && x < frame.left + hold) return true;
  if (!(right ? x >= frame.right && x < Math.min(screen, frame.right + REACH) : x < frame.left && x >= Math.max(0, frame.left - REACH))) return false;
  return document.hasFocus() || (right ? screen - frame.right : frame.left) <= REACH;
}

function check(pointer: PointerSample | null = currentPointer()) {
  const frame = windowFrame();
  for (const [id, edge] of [...watched]) {
    if (!watched.has(id)) continue;
    const now = isOver(pointer, edge);
    const fresh = unreported.delete(id);
    if (!fresh && now === over.has(id)) continue;
    if (now) over.add(id);
    else over.delete(id);
    const x = pointer?.clientX ?? -1;
    const y = pointer?.clientY ?? -1;
    const point: [number, number] = frame ? [x - frame.left, y - frame.top] : [x, y];
    emitNativeEvent("ArdiaShell", "onWindowEvent", { type: "leftEdge", id, over: now, right: edge.right, point });
  }
}

const HOLDING_CLASS = "ardia-pointer-hold";

function holdPagePointer() {
  const holding = [...watched.values()].some((edge) => edge.hold > 0);
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
  if (on) {
    watched.set(id, { hold: Math.max(0, hold), right });
    unreported.add(id);
  } else {
    watched.delete(id);
    over.delete(id);
  }
  listen(watched.size > 0);
  holdPagePointer();
  if (watched.size) check();
}

provideNativeModule("ArdiaShell", { watchLeftEdge: async (id: string, on: boolean, hold: number, right: boolean) => watchLeftEdge(id, on, hold, right) });
