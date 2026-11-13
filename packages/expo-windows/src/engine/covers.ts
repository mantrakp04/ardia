export type CoverRect = { x: number; y: number; width: number; height: number; radius: number };

type Listener = (windowId: string) => void;

const covers = new Map<string, Map<string, CoverRect>>();
const listeners = new Set<Listener>();
const radii = new Map<string, number>();
const fullScreenPages = new Map<string, string>();
let defaultRadius = 0;

const changed = (windowId: string) => {
  for (const listener of [...listeners]) listener(windowId);
};

const same = (a: CoverRect | undefined, b: CoverRect) => !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.radius === b.radius;

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

export function coversIn(windowId: string, except: readonly string[] = []): CoverRect[] {
  return [...(covers.get(windowId) ?? [])].filter(([id]) => !except.includes(id)).map(([, rect]) => rect);
}

export function setPageRadius(radius: number, windowId = "") {
  if (windowId) radii.set(windowId, radius);
  else defaultRadius = radius;
  if (windowId) changed(windowId);
  else for (const id of new Set([...covers.keys(), ...radii.keys()])) changed(id);
}

export const pageRadiusIn = (windowId: string) => radii.get(windowId) ?? defaultRadius;

export function setFullScreenPage(windowId: string, key: string, on: boolean) {
  if (on) {
    if (fullScreenPages.get(windowId) === key) return;
    fullScreenPages.set(windowId, key);
  } else {
    if (fullScreenPages.get(windowId) !== key) return;
    fullScreenPages.delete(windowId);
  }
  changed(windowId);
}

export const hiddenByFullScreen = (windowId: string, key: string) => {
  const shown = fullScreenPages.get(windowId);
  return shown !== undefined && shown !== key;
};

export function onCoversChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
