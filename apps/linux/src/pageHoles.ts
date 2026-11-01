import { intersection, subtract, type PageArea, type Rect } from "./inputRegions.ts";
import type { CornerRadii } from "./hostExtensionView.ts";

export const PAGE_CORNER_RADIUS = 12;
export const HOLE_HOST_CLASS = "ardia-hole-host";
const FILL_VAR = "--ardia-hole-fill";
const CLIP_VAR = "--ardia-hole-clip";

const n = (value: number) => +value.toFixed(2);

export type Radii = readonly [topLeft: number, topRight: number, bottomRight: number, bottomLeft: number];
export type HolePiece = { rect: Rect; radii: Radii };
export type FloatingHole = { rect: Rect; radius: number };
export type Hole = Rect & { radii?: CornerRadii };

const tupleOf = (radii: CornerRadii): Radii => [radii.upperLeft, radii.upperRight, radii.lowerRight, radii.lowerLeft];

export function roundedRect({ x, y, width, height }: Rect, radius: number | Radii) {
  const fit = (r: number) => Math.max(0, Math.min(r, width / 2, height / 2));
  const corners: Radii = typeof radius === "number" ? [radius, radius, radius, radius] : radius;
  const tl = fit(corners[0]);
  const tr = fit(corners[1]);
  const br = fit(corners[2]);
  const bl = fit(corners[3]);
  const right = x + width;
  const bottom = y + height;
  const arc = (r: number, toX: number, toY: number) => (r ? `A${n(r)} ${n(r)} 0 0 1 ${n(toX)} ${n(toY)}` : "");
  return `M${n(x + tl)} ${n(y)}H${n(right - tr)}${arc(tr, right, y + tr)}V${n(bottom - br)}${arc(br, right - br, bottom)}H${n(x + bl)}${arc(bl, x, bottom - bl)}V${n(y + tl)}${arc(tl, x + tl, y)}Z`;
}

export function holeClipPath(box: { width: number; height: number }, holes: readonly Hole[], radius = PAGE_CORNER_RADIUS, pieces: readonly HolePiece[] = []) {
  if (!holes.length && !pieces.length) return "";
  const outer = `M0 0H${n(box.width)}V${n(box.height)}H0Z`;
  return `path(evenodd, "${[outer, ...holes.map((hole) => roundedRect(hole, hole.radii ? tupleOf(hole.radii) : radius)), ...pieces.map((piece) => roundedRect(piece.rect, piece.radii))].join(" ")}")`;
}

export function floatingPieces(hole: FloatingHole, pages: readonly Rect[]): HolePiece[] {
  const { rect, radius } = hole;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  let pieces: Rect[] = [rect];
  for (const page of pages) pieces = pieces.flatMap((piece) => subtract(piece, page));
  return pieces.map((piece) => {
    const pieceRight = piece.x + piece.width;
    const pieceBottom = piece.y + piece.height;
    const corner = (x: number, y: number, cornerX: number, cornerY: number) => (near(x, cornerX) && near(y, cornerY) ? radius : 0);
    return {
      rect: piece,
      radii: [corner(piece.x, piece.y, rect.x, rect.y), corner(pieceRight, piece.y, right, rect.y), corner(pieceRight, pieceBottom, right, bottom), corner(piece.x, pieceBottom, rect.x, bottom)] as const,
    };
  });
}

export function localPieces(layer: Rect, scale: { x: number; y: number }, pieces: readonly HolePiece[]) {
  return pieces.filter((piece) => intersection(piece.rect, layer)).map((piece) => ({
    rect: { x: (piece.rect.x - layer.x) / scale.x, y: (piece.rect.y - layer.y) / scale.y, width: piece.rect.width / scale.x, height: piece.rect.height / scale.y },
    radii: piece.radii.map((radius) => radius / Math.min(scale.x, scale.y)) as unknown as Radii,
  }));
}

export function localHoles(layer: Rect, scale: { x: number; y: number }, pages: readonly Hole[]) {
  const holes: Hole[] = [];
  const shrink = Math.max(scale.x, scale.y) || 1;
  for (const page of pages) {
    if (!intersection(page, layer)) continue;
    const hole: Hole = { x: (page.x - layer.x) / scale.x, y: (page.y - layer.y) / scale.y, width: page.width / scale.x, height: page.height / scale.y };
    if (page.radii) hole.radii = { upperLeft: page.radii.upperLeft / shrink, upperRight: page.radii.upperRight / shrink, lowerRight: page.radii.lowerRight / shrink, lowerLeft: page.radii.lowerLeft / shrink };
    holes.push(hole);
  }
  return holes;
}

const transparent = (color: string) => !color || color === "transparent" || /^rgba\(.*,\s*0\)$/.test(color);

const box = (element: HTMLElement): Rect => {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
};

const clipFor = (element: HTMLElement, pages: readonly Hole[], pieces: readonly HolePiece[] = []) => {
  const rect = box(element);
  const scale = { x: element.offsetWidth ? rect.width / element.offsetWidth : 1, y: element.offsetHeight ? rect.height / element.offsetHeight : 1 };
  return holeClipPath({ width: element.offsetWidth, height: element.offsetHeight }, localHoles(rect, scale, pages), PAGE_CORNER_RADIUS, localPieces(rect, scale, pieces));
};

const holesOf = (pages: readonly PageArea[]): Hole[] => pages.map(({ rect, radii }) => (radii ? { ...rect, radii } : rect));

export function createPageHoles(root: HTMLElement) {
  const layers = new Set<HTMLElement>();
  const hosts = new Map<HTMLElement, string>();
  let pages: readonly PageArea[] = [];
  let floating: FloatingHole | null = null;
  let floatingHosts: readonly HTMLElement[] = [];
  let queued = false;
  const pieces = () => (floating ? floatingPieces(floating, pages.map((page) => page.rect)) : []);

  const setStyle = (element: HTMLElement, name: string, value: string) => {
    if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
  };

  const paintLayer = (layer: HTMLElement) => {
    const clip = clipFor(layer, holesOf(pages), pieces());
    if (layer.style.clipPath !== clip) layer.style.clipPath = clip;
  };

  const ancestorsOf = (slot: Element) => {
    const chain: HTMLElement[] = [];
    for (let node = slot.parentElement; node && node !== root; node = node.parentElement) chain.push(node);
    return chain;
  };

  const syncHosts = () => {
    const rects = holesOf(pages);
    const floatingRects = pieces();
    const painting = new Set<HTMLElement>();
    const paints = (node: HTMLElement) => hosts.has(node) || !transparent(node.style.backgroundColor) || !transparent(getComputedStyle(node).backgroundColor);
    for (const { slot } of pages) {
      for (const node of ancestorsOf(slot)) {
        if (paints(node)) painting.add(node);
      }
    }
    if (floating) for (const node of floatingHosts) if (node.isConnected && paints(node)) painting.add(node);
    for (const host of hosts.keys()) {
      if (painting.has(host)) continue;
      host.classList.remove(HOLE_HOST_CLASS);
      host.style.removeProperty(FILL_VAR);
      host.style.removeProperty(CLIP_VAR);
      hosts.delete(host);
    }
    for (const host of painting) {
      if (!hosts.has(host)) {
        hosts.set(host, host.style.backgroundColor ? "" : getComputedStyle(host).backgroundColor);
        host.classList.add(HOLE_HOST_CLASS);
      }
      setStyle(host, FILL_VAR, host.style.backgroundColor || hosts.get(host)!);
      setStyle(host, CLIP_VAR, clipFor(host, rects, floatingRects) || "none");
    }
    watched.disconnect();
    for (const { slot } of pages) for (const node of ancestorsOf(slot)) watched.observe(node, { attributes: true, attributeFilter: ["style"] });
  };

  const watched = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      syncHosts();
    });
  });

  const resized = new ResizeObserver((entries) => {
    for (const entry of entries) if (layers.has(entry.target as HTMLElement)) paintLayer(entry.target as HTMLElement);
  });

  return {
    pagesChanged(next: readonly PageArea[]) {
      pages = next;
      for (const layer of layers) paintLayer(layer);
      syncHosts();
    },
    setFloating(hole: FloatingHole | null, nextHosts: readonly HTMLElement[] = []) {
      floating = hole;
      floatingHosts = hole ? nextHosts : [];
      for (const layer of layers) paintLayer(layer);
      syncHosts();
    },
    isLayer: (element: Element) => layers.has(element as HTMLElement),
    isHost: (element: Element) => hosts.has(element as HTMLElement),
    addLayer(layer: HTMLElement) {
      layers.add(layer);
      resized.observe(layer);
      paintLayer(layer);
      return () => {
        layers.delete(layer);
        resized.unobserve(layer);
        layer.style.clipPath = "";
      };
    },
  };
}

export type PageHoles = ReturnType<typeof createPageHoles>;
