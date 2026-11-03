import { roundedRect, type FloatingHole } from "./pageHoles.ts";
import type { Rect } from "./pipGeometry.ts";

export type HoleNode = { parentElement: HoleNode | null; children: ArrayLike<HoleNode> };

export type HoleDeps<N extends HoleNode> = {
  rectOf: (node: N) => Rect;
  paints: (node: N) => boolean;
  managed: (node: N) => boolean;
  clippedElsewhere: (node: N) => boolean;
};

export type HolePlan<N> = { clip: N[]; hosts: N[] };

const meets = (a: Rect, b: Rect) => a.width > 0 && a.height > 0 && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export function planHoles<N extends HoleNode>(roots: readonly N[], hole: Rect, keep: readonly N[], deps: HoleDeps<N>): HolePlan<N> {
  const kept = new Set<HoleNode>(keep);
  const holding = new Set<HoleNode>();
  for (const node of keep) for (let parent = node.parentElement; parent; parent = parent.parentElement) holding.add(parent);
  const clip: N[] = [];
  const hosts: N[] = [];
  const touches = (node: N): boolean => {
    if (meets(deps.rectOf(node), hole)) return true;
    for (let i = 0; i < node.children.length; i++) if (touches(node.children[i] as N)) return true;
    return false;
  };
  const visit = (node: N) => {
    if (kept.has(node) || deps.managed(node)) return;
    if (holding.has(node) || deps.clippedElsewhere(node)) {
      if (deps.paints(node) && meets(deps.rectOf(node), hole)) hosts.push(node);
      for (let i = 0; i < node.children.length; i++) visit(node.children[i] as N);
      return;
    }
    if (touches(node)) clip.push(node);
  };
  for (const root of roots) visit(root);
  return { clip, hosts };
}

const FAR = 100000;

export function holeClip(local: Rect, radius: number) {
  return `path(evenodd, "M${-FAR} ${-FAR}H${FAR}V${FAR}H${-FAR}Z ${roundedRect(local, radius)}")`;
}

export function cutClip(local: readonly Rect[]) {
  if (!local.length) return "";
  const cuts = local.map(({ x, y, width, height }) => `M${x} ${y}H${x + width}V${y + height}H${x}Z`).join(" ");
  return `path(evenodd, "M${-FAR} ${-FAR}H${FAR}V${FAR}H${-FAR}Z ${cuts}")`;
}

export function hitRects(element: Element, receives: (element: Element) => boolean, rectOf: (element: Element) => Rect, out: Rect[] = []) {
  if (receives(element)) {
    const rect = rectOf(element);
    if (rect.width > 0 && rect.height > 0) out.push(rect);
    return out;
  }
  for (const child of element.children) hitRects(child, receives, rectOf, out);
  return out;
}

const transparent = (color: string) => !color || color === "transparent" || /^rgba\(.*,\s*0\)$/.test(color);

export function domHoleDeps(isLayer: (element: Element) => boolean, mine: (element: Element) => boolean): HoleDeps<HTMLElement & HoleNode> {
  return {
    rectOf: (element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    },
    paints: (element) => !transparent(getComputedStyle(element).backgroundColor) || element.classList.contains("ardia-hole-host"),
    managed: (element) => isLayer(element),
    clippedElsewhere: (element) => !mine(element) && getComputedStyle(element).clipPath !== "none",
  };
}

export type PlayerHoleTarget = {
  setFloating(hole: FloatingHole | null, hosts?: readonly HTMLElement[]): void;
  isLayer(element: Element): boolean;
};

export type FrameClock = { request: (run: () => void) => number; cancel: (frame: number) => void };

export function nextFrameRunner(run: () => void, clock: FrameClock = { request: (next) => requestAnimationFrame(next), cancel: (frame) => cancelAnimationFrame(frame) }) {
  let pending: number | null = null;
  let stopped = false;
  return {
    schedule() {
      if (stopped || pending !== null) return;
      pending = clock.request(() => {
        pending = null;
        run();
      });
    },
    stop() {
      stopped = true;
      if (pending !== null) clock.cancel(pending);
      pending = null;
    },
  };
}

export function createPlayerHoles(target: () => PlayerHoleTarget | null) {
  const clipped = new Map<HTMLElement, string>();
  const mine = (element: Element) => clipped.has(element as HTMLElement);

  const release = (keep: Set<HTMLElement>) => {
    for (const [element, previous] of clipped) {
      if (keep.has(element)) continue;
      element.style.clipPath = previous;
      clipped.delete(element);
    }
  };

  return {
    apply(hole: FloatingHole | null, roots: readonly HTMLElement[], keep: readonly HTMLElement[]) {
      const holes = target();
      if (!hole || !holes) {
        release(new Set());
        holes?.setFloating(null);
        return;
      }
      const plan = planHoles(roots as (HTMLElement & HoleNode)[], hole.rect, keep as (HTMLElement & HoleNode)[], domHoleDeps((element) => holes.isLayer(element), mine));
      const next = new Set<HTMLElement>(plan.clip);
      release(next);
      for (const element of plan.clip) {
        const { x, y, width, height } = element.getBoundingClientRect();
        const scaleX = element.offsetWidth ? width / element.offsetWidth : 1;
        const scaleY = element.offsetHeight ? height / element.offsetHeight : 1;
        const local = { x: (hole.rect.x - x) / scaleX, y: (hole.rect.y - y) / scaleY, width: hole.rect.width / scaleX, height: hole.rect.height / scaleY };
        const clip = holeClip(local, hole.radius / Math.min(scaleX, scaleY));
        if (!clipped.has(element)) clipped.set(element, element.style.clipPath);
        if (element.style.clipPath !== clip) element.style.clipPath = clip;
      }
      holes.setFloating(hole, plan.hosts);
    },
    clear() {
      release(new Set());
      target()?.setFloating(null);
    },
    clippedElements: () => [...clipped.keys()],
  };
}
