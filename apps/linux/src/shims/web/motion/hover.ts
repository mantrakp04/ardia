import { currentPointer, watchPointer, type PointerSample } from "./pointer";

export type MacMouseEvent = {
  nativeEvent: { clientX: number; clientY: number; screenX: number; screenY: number; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean };
  stopPropagation: () => void;
  preventDefault: () => void;
};

export type MouseHandler = (e: MacMouseEvent) => void;

const WINDOW_SELECTOR = ".ardia-window";

export function macEvent(node: HTMLElement, e: PointerSample): MacMouseEvent {
  const r = node.getBoundingClientRect();
  const frame = node.closest(WINDOW_SELECTOR)?.getBoundingClientRect();
  const windowX = frame ? e.clientX - frame.left : e.clientX;
  const windowY = frame ? frame.bottom - e.clientY : window.innerHeight - e.clientY;
  return {
    nativeEvent: {
      clientX: e.clientX - r.left,
      clientY: e.clientY - r.top,
      screenX: windowX,
      screenY: windowY,
      ...(e.shiftKey && { shiftKey: true }),
      ...(e.ctrlKey && { ctrlKey: true }),
      ...(e.altKey && { altKey: true }),
      ...(e.metaKey && { metaKey: true }),
    },
    stopPropagation: () => {},
    preventDefault: () => {},
  };
}

export type TrackedHover = { node: () => HTMLElement | null; enter: () => MouseHandler | undefined; leave: () => MouseHandler | undefined; inside: boolean };

const tracked = new Set<TrackedHover>();
const OUTSIDE: PointerSample = { clientX: -1e5, clientY: -1e5, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };
let stopTracking: (() => void) | null = null;

function contains(node: HTMLElement, p: PointerSample) {
  if (!node.isConnected) return false;
  const r = node.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && p.clientX >= r.left && p.clientX < r.right && p.clientY >= r.top && p.clientY < r.bottom;
}

function settle(t: TrackedHover, p: PointerSample | null) {
  const node = t.node();
  if (!node) return;
  const inside = !!p && contains(node, p);
  if (inside === t.inside) return;
  t.inside = inside;
  const handler = inside ? t.enter() : t.leave();
  if (handler) handler(macEvent(node, p ?? OUTSIDE));
}

function updateTracked(p: PointerSample | null) {
  for (const t of [...tracked]) settle(t, p);
}

export function trackHover(entry: TrackedHover) {
  tracked.add(entry);
  stopTracking ??= watchPointer(updateTracked);
  settle(entry, currentPointer());
  return () => {
    tracked.delete(entry);
    if (tracked.size || !stopTracking) return;
    stopTracking();
    stopTracking = null;
  };
}
