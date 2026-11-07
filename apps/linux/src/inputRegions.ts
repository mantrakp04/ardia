import type { HostInputRegions, HostRect } from "./host.ts";
import type { CornerRadii } from "./hostExtensionView.ts";

export type Rect = HostRect;
export type RegionShape = "box" | "hit";
export type PageArea = { slot: Element; rect: Rect; radii?: CornerRadii };
type Page = { visible: boolean; radii?: () => CornerRadii };

export const REVEAL_DEADLINE_MS = 150;
export const SETTLE_FRAMES = 12;
export const REVEAL_SLACK_PX = 24;

export type RegionDeps = {
  send: ((regions: HostInputRegions) => Promise<unknown>) | null;
  viewport: () => { width: number; height: number };
  rectOf: (element: Element) => Rect;
  receivesPointer: (element: Element) => boolean;
  watch: (element: Element, changed: () => void) => () => void;
  animating: (elements: readonly Element[]) => boolean;
  conceal: (element: Element, hidden: boolean) => void;
  microtask: (run: () => void) => void;
  frame: (run: () => void) => void;
  frameTime: () => number;
  timeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  pagesChanged?: (pages: readonly PageArea[]) => void;
  report?: (error: unknown) => void;
};

const area = (rect: Rect) => rect.width > 0 && rect.height > 0;

export function intersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

export function subtract(from: Rect, hole: Rect): Rect[] {
  const cut = intersection(from, hole);
  if (!cut) return [from];
  const right = from.x + from.width;
  const bottom = from.y + from.height;
  const pieces: Rect[] = [
    { x: from.x, y: from.y, width: from.width, height: cut.y - from.y },
    { x: from.x, y: cut.y + cut.height, width: from.width, height: bottom - cut.y - cut.height },
    { x: from.x, y: cut.y, width: cut.x - from.x, height: cut.height },
    { x: cut.x + cut.width, y: cut.y, width: right - cut.x - cut.width, height: cut.height },
  ];
  return pieces.filter(area);
}

export const within = (inner: Rect, outer: Rect, slack = 0) =>
  inner.x >= outer.x - slack && inner.y >= outer.y - slack && inner.x + inner.width <= outer.x + outer.width + slack && inner.y + inner.height <= outer.y + outer.height + slack;

const rounded = (rect: Rect): Rect => ({ x: Math.round(rect.x * 100) / 100, y: Math.round(rect.y * 100) / 100, width: Math.round(rect.width * 100) / 100, height: Math.round(rect.height * 100) / 100 });

type Overlay = { shape: RegionShape; gated: boolean; stop: () => void; rects: Rect[]; waiting: unknown | null; shown: boolean };

export function createInputRegions(deps: RegionDeps) {
  const pages = new Map<Element, Page>();
  const overlays = new Map<Element, Overlay>();
  let flushQueued = false;
  let frameQueued = false;
  let sentKey = "";
  let pagesKey = "";
  let sentFrame = Number.NaN;
  let inFlight = false;
  let stillFrames = 0;
  let queued: HostInputRegions | null = null;
  let acked: Rect[] = [];
  let sequence = 0;
  let ackedSequence = 0;

  const schedule = () => {
    if (flushQueued) return;
    flushQueued = true;
    deps.microtask(() => {
      flushQueued = false;
      flush();
    });
  };
  const nextFrame = () => {
    if (frameQueued) return;
    frameQueued = true;
    deps.frame(() => {
      frameQueued = false;
      flush();
    });
  };

  const hitRects = (element: Element, out: Rect[]) => {
    if (deps.receivesPointer(element)) {
      const rect = deps.rectOf(element);
      if (area(rect)) out.push(rect);
      return;
    }
    for (const child of element.children) hitRects(child, out);
  };

  const measurePages = () => {
    const window = { x: 0, y: 0, ...deps.viewport() };
    const areas: PageArea[] = [];
    for (const [slot, { visible, radii }] of pages) {
      if (!visible || !slot.isConnected) continue;
      const clipped = intersection(deps.rectOf(slot), window);
      if (clipped) areas.push({ slot, rect: rounded(clipped), ...(radii ? { radii: radii() } : {}) });
    }
    return areas;
  };

  const measureOverlay = (element: Element, shape: RegionShape) => {
    const raw: Rect[] = [];
    if (shape === "box") {
      const rect = deps.rectOf(element);
      if (area(rect)) raw.push(rect);
    } else hitRects(element, raw);
    const hosted = [...pages.keys()].filter((slot) => element.contains(slot)).map(deps.rectOf);
    return raw.flatMap((rect) => hosted.reduce<Rect[]>((pieces, hole) => pieces.flatMap((piece) => subtract(piece, hole)), [rect])).map(rounded);
  };

  const reveal = (element: Element, overlay: Overlay) => {
    if (overlay.waiting === null) return;
    deps.clearTimeout(overlay.waiting);
    overlay.waiting = null;
    overlay.shown = true;
    deps.conceal(element, false);
  };

  const reserved = (rects: readonly Rect[], pageRects: readonly Rect[], slack: number) =>
    rects.every((rect) => !pageRects.some((page) => intersection(rect, page)) || acked.some((done) => within(rect, done, slack)));

  const revealReserved = (pageRects: readonly Rect[]) => {
    for (const [element, overlay] of overlays) if (overlay.waiting !== null && reserved(overlay.rects, pageRects, REVEAL_SLACK_PX)) reveal(element, overlay);
  };

  const transmit = (regions: HostInputRegions) => {
    if (inFlight) {
      queued = regions;
      return;
    }
    const mine = ++sequence;
    inFlight = true;
    sentFrame = deps.frameTime();
    deps.send!(regions).then(
      () => {
        if (mine > ackedSequence) {
          ackedSequence = mine;
          acked = regions.overlays;
        }
        revealReserved(regions.pages);
      },
      (error) => {
        deps.report?.(error);
        for (const [element, overlay] of overlays) reveal(element, overlay);
      },
    ).finally(() => {
      inFlight = false;
      const next = queued;
      queued = null;
      if (next) transmit(next);
    });
  };

  const flush = () => {
    const areas = measurePages();
    const pageRects = areas.map((page) => page.rect);
    const key = JSON.stringify(areas.map((page) => [page.rect, page.radii ?? null]));
    if (key !== pagesKey) {
      pagesKey = key;
      deps.pagesChanged?.(areas);
    }
    let urgent = false;
    let moving = false;
    for (const [element, overlay] of overlays) {
      const rects = measureOverlay(element, overlay.shape);
      if (JSON.stringify(rects) !== JSON.stringify(overlay.rects)) moving = true;
      overlay.rects = rects;
      if (!deps.send) continue;
      const safe = reserved(overlay.rects, pageRects, REVEAL_SLACK_PX);
      if (overlay.waiting !== null) {
        if (safe && !overlay.rects.some((rect) => pageRects.some((page) => intersection(rect, page)))) reveal(element, overlay);
        continue;
      }
      if (safe) {
        overlay.shown = true;
        continue;
      }
      urgent = true;
      if (!overlay.gated || overlay.shown) continue;
      deps.conceal(element, true);
      overlay.waiting = deps.timeout(() => reveal(element, overlay), REVEAL_DEADLINE_MS);
    }
    stillFrames = moving ? 0 : stillFrames + 1;
    if (overlays.size && (stillFrames < SETTLE_FRAMES || deps.animating([...overlays.keys()]))) nextFrame();
    if (!deps.send) return;
    const regions = { pages: pageRects, overlays: [...overlays.values()].flatMap((overlay) => overlay.rects) };
    const regionsKey = JSON.stringify(regions);
    if (regionsKey === sentKey) return;
    if (!urgent && sentFrame === deps.frameTime()) {
      nextFrame();
      return;
    }
    sentKey = regionsKey;
    transmit(regions);
  };

  return {
    setPage(slot: Element, visible: boolean, radii?: () => CornerRadii) {
      const known = pages.get(slot);
      if (known?.visible === visible && known.radii === radii) return;
      pages.set(slot, { visible, ...(radii ? { radii } : {}) });
      schedule();
    },
    dropPage(slot: Element) {
      if (pages.delete(slot)) schedule();
    },
    addOverlay(element: Element, shape: RegionShape = "box", gated = true) {
      const overlay: Overlay = { shape, gated, stop: () => {}, rects: [], waiting: null, shown: false };
      overlays.set(element, overlay);
      stillFrames = 0;
      overlay.stop = deps.watch(element, schedule);
      schedule();
      return () => {
        if (overlays.get(element) !== overlay) return;
        overlay.stop();
        reveal(element, overlay);
        overlays.delete(element);
        schedule();
      };
    },
    overlayElements: () => [...overlays.keys()],
    overlayAt(x: number, y: number) {
      for (const [element, overlay] of overlays) if (measureOverlay(element, overlay.shape).some((rect) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height)) return true;
      return false;
    },
    refresh: schedule,
    status: () => ({ supported: !!deps.send, sent: sentKey ? (JSON.parse(sentKey) as HostInputRegions) : null, sequence, acked: ackedSequence, overlays: overlays.size, pages: pages.size }),
    flushNow: flush,
  };
}

export type InputRegionsRegistry = ReturnType<typeof createInputRegions>;
