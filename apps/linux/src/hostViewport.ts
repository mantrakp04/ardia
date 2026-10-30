import type { TabViewport as HostTabViewport } from "./hostTab";

export type TabViewport = HostTabViewport & { occlusions?: (HostTabViewport["rect"] & { paintOutset?: number })[] };

type Bounds = { x: number; y: number; width: number; height: number };

const EXTENSION_POPUP = '[data-testid="ardia-extension-popup"]';
const EXTENSION_POPUP_DISMISS = '[data-testid="ardia-extension-popup-dismiss"]';
const SIDEBAR_PEEK = '[data-testid="ardia-sidebar-peek"]';
const COVERING = `${SIDEBAR_PEEK}, [data-testid="ardia-sidebar-hover"], [data-testid="ardia-page-overlay"], ${EXTENSION_POPUP}`;
const MOTION_EVENTS = ["transitionrun", "transitionend", "transitioncancel", "animationstart", "animationend", "animationcancel"] as const;

const viewportWatchers = new Set<() => void>();
export const refreshTabViewports = () => {
  for (const watcher of viewportWatchers) watcher();
};

let overlayBlocked = (_key: string | undefined) => false;
export const hostOverlayBlocked = (key: string | undefined) => overlayBlocked(key);
export const setHostOverlayCheck = (check: typeof overlayBlocked) => void (overlayBlocked = check);

export function backdropCovers(captured: readonly Bounds[], occlusions: readonly Bounds[]) {
  return occlusions.every((next) => captured.some((taken) =>
    next.x < taken.x + taken.width && next.x + next.width > taken.x && next.y < taken.y + taken.height && next.y + next.height > taken.y));
}

export function tabViewport(rect: Bounds, viewport: { width: number; height: number }, visible: boolean): TabViewport {
  const finite = [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite);
  const intersects = finite && rect.width > 0 && rect.height > 0 && rect.x < viewport.width && rect.y < viewport.height && rect.x + rect.width > 0 && rect.y + rect.height > 0;
  return { rect: finite ? { x: rect.x, y: rect.y, width: Math.max(0, rect.width), height: Math.max(0, rect.height) } : { x: 0, y: 0, width: 0, height: 0 }, visible: visible && intersects };
}

export function watchTabViewport(element: HTMLElement, visible: () => boolean, report: (viewport: TabViewport) => void) {
  let frame = 0;
  let stopped = false;
  const measure = () => {
    if (stopped) return;
    const rect = element.getBoundingClientRect();
    const viewport = tabViewport(rect, { width: window.innerWidth, height: window.innerHeight }, visible() && !document.hidden && element.isConnected);
    const peeks = [...document.querySelectorAll<HTMLElement>(SIDEBAR_PEEK)].map((peek) => peek.getBoundingClientRect());
    const overlays = [...document.querySelectorAll<HTMLElement>('[data-testid="ardia-sidebar-hover"] > div > div, [data-testid="ardia-page-overlay"] > div > div')];
    const popup = document.querySelector<HTMLElement>(EXTENSION_POPUP);
    const above = popup && !popup.contains(element) ? popup : null;
    const covering = above ? [...overlays, above] : overlays;
    const dismiss = above && document.querySelector<HTMLElement>(EXTENSION_POPUP_DISMISS);
    if (viewport.visible) {
      const occlusions = [...peeks, ...covering.map((card) => card.getBoundingClientRect())].filter((card) => card.width > 0 && card.height > 0 && card.left < rect.right && card.right > rect.left && card.top < rect.bottom && card.bottom > rect.top);
      if (occlusions.length) viewport.occlusions = occlusions.map(({ x, y, width, height }) => ({ x, y, width, height, paintOutset: 32 }));
      for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
          viewport.visible = false;
          break;
        }
      }
    }
    if (viewport.visible) {
      const insetX = Math.min(16, rect.width / 4);
      const insetY = Math.min(16, rect.height / 4);
      const left = Math.max(0, rect.left) + insetX;
      const top = Math.max(0, rect.top) + insetY;
      const right = Math.min(window.innerWidth, rect.right) - insetX;
      const bottom = Math.min(window.innerHeight, rect.bottom) - insetY;
      const points = [[left, top], [right, top], [left, bottom], [right, bottom], [(left + right) / 2, (top + bottom) / 2]];
      viewport.visible = points.every(([x, y]) => {
        if (peeks.some((peek) => x! >= peek.left && x! < peek.right && y! >= peek.top && y! < peek.bottom)) return true;
        const hit = document.elementFromPoint(x!, y!);
        return !!hit && (hit === element || element.contains(hit) || covering.some((card) => card === hit || card.contains(hit)) || !!dismiss?.contains(hit));
      });
    }
    report(viewport);
    if (animating()) measureNextFrame();
  };
  const animating = () => !!document.getAnimations?.().some((animation) => {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    return animation.playState === "running" && !!target && (target.contains(element) || !!target.closest(COVERING));
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
