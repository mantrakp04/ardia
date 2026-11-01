import type { TabViewport } from "./hostTab";

export type { TabViewport };

type Bounds = { x: number; y: number; width: number; height: number };

const EXTENSION_POPUP_DISMISS = '[data-testid="ardia-extension-popup-dismiss"]';
const MOTION_EVENTS = ["transitionrun", "transitionend", "transitioncancel", "animationstart", "animationend", "animationcancel"] as const;

const viewportWatchers = new Set<() => void>();
export const refreshTabViewports = () => {
  for (const watcher of viewportWatchers) watcher();
};

export function tabViewport(rect: Bounds, viewport: { width: number; height: number }, visible: boolean): TabViewport {
  const finite = [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite);
  const intersects = finite && rect.width > 0 && rect.height > 0 && rect.x < viewport.width && rect.y < viewport.height && rect.x + rect.width > 0 && rect.y + rect.height > 0;
  return { rect: finite ? { x: rect.x, y: rect.y, width: Math.max(0, rect.width), height: Math.max(0, rect.height) } : { x: 0, y: 0, width: 0, height: 0 }, visible: visible && intersects };
}

function plainViewport(element: HTMLElement, rect: DOMRect, viewport: TabViewport, cover: OverlayCover): TabViewport {
  if (!viewport.visible) return viewport;
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return { ...viewport, visible: false };
  }
  const insetX = Math.min(16, rect.width / 4);
  const insetY = Math.min(16, rect.height / 4);
  const left = Math.max(0, rect.left) + insetX;
  const top = Math.max(0, rect.top) + insetY;
  const right = Math.min(window.innerWidth, rect.right) - insetX;
  const bottom = Math.min(window.innerHeight, rect.bottom) - insetY;
  const dismiss = document.querySelector<HTMLElement>(EXTENSION_POPUP_DISMISS);
  const points = [[left, top], [right, top], [left, bottom], [right, bottom], [(left + right) / 2, (top + bottom) / 2]] as const;
  const shown = points.every(([x, y]) => {
    if (cover.overlayAt(x, y)) return true;
    const hit = document.elementFromPoint(x, y);
    return !!hit && (hit === element || element.contains(hit) || !!dismiss?.contains(hit));
  });
  return shown ? viewport : { ...viewport, visible: false };
}

export type OverlayCover = { overlayAt: (x: number, y: number) => boolean; overlayElements: () => readonly Element[] };

export function watchTabViewport(element: HTMLElement, visible: () => boolean, report: (viewport: TabViewport) => void, cover: OverlayCover) {
  let frame = 0;
  let stopped = false;
  const measure = () => {
    if (stopped) return;
    const rect = element.getBoundingClientRect();
    const viewport = tabViewport(rect, { width: window.innerWidth, height: window.innerHeight }, visible() && !document.hidden && element.isConnected);
    report(plainViewport(element, rect, viewport, cover));
    if (animating()) measureNextFrame();
  };
  const animating = () => !!document.getAnimations?.().some((animation) => {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    if (animation.playState !== "running" || !target) return false;
    return target.contains(element) || cover.overlayElements().some((overlay) => overlay.contains(target));
  });
  const measureNextFrame = () => {
    if (frame || stopped) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      measure();
    });
  };
  const mutations = new MutationObserver(measureNextFrame);
  mutations.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  const resizes = new ResizeObserver(measure);
  resizes.observe(element);
  viewportWatchers.add(measureNextFrame);
  window.addEventListener("resize", measure);
  window.addEventListener("scroll", measure, true);
  document.addEventListener("visibilitychange", measure);
  for (const type of MOTION_EVENTS) document.addEventListener(type, measureNextFrame, true);
  window.visualViewport?.addEventListener("resize", measure);
  window.visualViewport?.addEventListener("scroll", measure);
  measure();
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    mutations.disconnect();
    resizes.disconnect();
    viewportWatchers.delete(measureNextFrame);
    window.removeEventListener("resize", measure);
    window.removeEventListener("scroll", measure, true);
    document.removeEventListener("visibilitychange", measure);
    for (const type of MOTION_EVENTS) document.removeEventListener(type, measureNextFrame, true);
    window.visualViewport?.removeEventListener("resize", measure);
    window.visualViewport?.removeEventListener("scroll", measure);
  };
}
