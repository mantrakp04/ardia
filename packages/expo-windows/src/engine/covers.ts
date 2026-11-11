export type CoverRect = { x: number; y: number; width: number; height: number };

type Listener = (windowId: string) => void;

const covers = new Map<string, Map<string, CoverRect>>();
const listeners = new Set<Listener>();
const radii = new Map<string, number>();
let defaultRadius = 0;

const changed = (windowId: string) => {
  for (const listener of [...listeners]) listener(windowId);
};

const same = (a: CoverRect | undefined, b: CoverRect) => !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

export function setCover(windowId: string, id: string, rect: CoverRect | null) {
  let inWindow = covers.get(windowId);
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) {
    if (!inWindow?.delete(id)) return;
    if (!inWindow.size) covers.delete(windowId);
    changed(windowId);
    return;
  }
  if (!inWindow) covers.set(windowId, (inWindow = new Map()));
  if (same(inWindow.get(id), rect)) return;
  inWindow.set(id, rect);
  changed(windowId);
}

export function coversIn(windowId: string): CoverRect[] {
  return [...(covers.get(windowId)?.values() ?? [])];
}

export function setPageRadius(radius: number, windowId = "") {
  if (windowId) radii.set(windowId, radius);
  else defaultRadius = radius;
  if (windowId) changed(windowId);
  else for (const id of new Set([...covers.keys(), ...radii.keys()])) changed(id);
}

export const pageRadiusIn = (windowId: string) => radii.get(windowId) ?? defaultRadius;

export function onCoversChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
