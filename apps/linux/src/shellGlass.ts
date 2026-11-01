import { createContext, useLayoutEffect, useSyncExternalStore, type RefObject } from "react";
import { parseColor } from "../../browser/src/lib/color";
import { hostSupports, invokeHost, reportHostError, type ArdiaHost } from "./host.ts";
import { createGlassRegions, GLASS_BLUR, GLASS_METHOD, GLASS_MODULE, type GlassApplied, type GlassGeometry, type GlassRegistry } from "./glassRegions.ts";
import { intersection, type Rect } from "./inputRegions.ts";

export const GlassOptIn = createContext(false);
export const GlassInside = createContext(false);

export const GLASS_ATTRIBUTE = "data-ardia-glass";
export const GLASS_ID_ATTRIBUTE = "data-ardia-glass-id";
export const VISUAL_EFFECT_ATTRIBUTE = "data-ardia-visual-effect";
export const GLASS_DIAGNOSTIC_CLASS = "ardia-glass-diagnostic";
export const GLASS_TINT_SHARE = 0.85;
export const GLASS_FILL_PROPERTY = "--ardia-glass-fill";
export const GLASS_BACKDROP = `blur(${GLASS_BLUR}px) saturate(180%)`;

const MOTION_EVENTS = ["transitionrun", "animationstart"] as const;

let registry: GlassRegistry | null = null;
export const shellGlass = () => registry;

const availabilityListeners = new Set<() => void>();
const announceAvailability = () => {
  for (const listener of availabilityListeners) listener();
};
const subscribeAvailability = (listener: () => void) => {
  availabilityListeners.add(listener);
  return () => void availabilityListeners.delete(listener);
};
const glassAvailable = () => registry?.available() ?? false;
export const useGlassAvailable = () => useSyncExternalStore(subscribeAvailability, glassAvailable, glassAvailable);

export function glassFill(fill: string) {
  const parsed = parseColor(fill);
  if (!parsed) return fill;
  const [r, g, b, a] = parsed;
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${+(a * GLASS_TINT_SHARE).toFixed(4)})`;
}

const px = (value: string) => parseFloat(value) || 0;
const clips = (style: CSSStyleDeclaration) => style.overflowX !== "visible" || style.overflowY !== "visible";
const box = (element: Element): Rect => {
  const r = element.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
};

export function measureGlass(element: Element): GlassGeometry | null {
  if (!element.isConnected) return null;
  const own = getComputedStyle(element);
  if (own.visibility === "hidden") return null;
  let opacity = 1;
  for (let node: Element | null = element; node && node !== document.documentElement; node = node.parentElement) {
    const style = node === element ? own : getComputedStyle(node);
    if (style.display === "none") return null;
    opacity *= Number(style.opacity);
  }
  if (!(opacity > 0)) return null;
  const rect = box(element);
  if (rect.width <= 0 || rect.height <= 0) return null;
  const html = element as HTMLElement;
  const scale = html.offsetWidth > 0 ? rect.width / html.offsetWidth : 1;
  let clip: Rect | null = rect;
  for (let node = element.parentElement; node && node !== document.documentElement && clip; node = node.parentElement) {
    if (clips(getComputedStyle(node))) clip = intersection(clip, box(node));
  }
  if (!clip) return null;
  const left = clip.x > rect.x + 0.01;
  const top = clip.y > rect.y + 0.01;
  const right = clip.x + clip.width < rect.x + rect.width - 0.01;
  const bottom = clip.y + clip.height < rect.y + rect.height - 0.01;
  const corner = (value: string, ...sides: boolean[]) => (sides.some(Boolean) ? 0 : px(value) * scale);
  return {
    rect: clip,
    radii: {
      upperLeft: corner(own.borderTopLeftRadius, left, top),
      upperRight: corner(own.borderTopRightRadius, right, top),
      lowerRight: corner(own.borderBottomRightRadius, right, bottom),
      lowerLeft: corner(own.borderBottomLeftRadius, left, bottom),
    },
    opacity: Math.min(1, opacity),
    scale: window.devicePixelRatio,
  };
}

function afterimage(element: Element, geometry: GlassGeometry) {
  const style = getComputedStyle(element);
  const ghost = document.createElement("div");
  const { rect, radii } = geometry;
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    borderRadius: `${radii.upperLeft}px ${radii.upperRight}px ${radii.lowerRight}px ${radii.lowerLeft}px`,
    backgroundColor: style.backgroundColor,
    backdropFilter: style.backdropFilter,
    opacity: String(geometry.opacity),
    pointerEvents: "none",
    zIndex: "2147483000",
  });
  ghost.setAttribute("aria-hidden", "true");
  ghost.dataset.ardiaGlassAfterimage = "";
  document.body.appendChild(ghost);
  return () => ghost.remove();
}

function watch(element: Element, changed: () => void) {
  const mutations = new MutationObserver(changed);
  mutations.observe(element, { attributes: true, attributeFilter: ["style", "class"] });
  const sizes = new ResizeObserver(changed);
  sizes.observe(element);
  return () => {
    mutations.disconnect();
    sizes.disconnect();
  };
}

function animating(element: Element) {
  return !!document.getAnimations?.().some((animation) => {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    return animation.playState === "running" && !!target && target.contains(element);
  });
}

export function startShellGlass(host: ArdiaHost) {
  const supported = hostSupports(GLASS_METHOD, host);
  const mutations = new MutationObserver(() => registry?.refresh());
  const glass = createGlassRegions(
    {
      send: supported ? (update) => invokeHost<GlassApplied>(GLASS_METHOD, update, host) : null,
      measure: measureGlass,
      apply: (element, translucent) => element.setAttribute(GLASS_ATTRIBUTE, translucent ? "on" : "off"),
      afterimage,
      watch,
      animating,
      frame: (run) => void requestAnimationFrame(run),
      timeout: (run, ms) => setTimeout(run, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      report: reportHostError,
      availability: announceAvailability,
      activity: (on) => {
        if (on) mutations.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class"] });
        else mutations.disconnect();
      },
    },
    supported && host.bootstrap.glassPanels === true,
  );
  registry = glass;
  announceAvailability();
  if (supported) {
    void invokeHost<GlassApplied>(GLASS_METHOD, { generation: 0, regions: [] }, host).then(
      (reply) => glass.setAvailable(reply?.available === true),
      reportHostError,
    );
  }
  const unsubscribe = host.onEvent((module, event, payload) => {
    if (module !== GLASS_MODULE || !payload || typeof payload !== "object") return;
    const value = payload as { generation?: number; value?: boolean };
    if (event === "presented" && typeof value.generation === "number") glass.presented(value.generation);
    else if (event === "available" && typeof value.value === "boolean") glass.setAvailable(value.value);
  });
  const motion = (event: Event) => {
    if (event.target instanceof Element) glass.motion(event.target);
  };
  for (const type of MOTION_EVENTS) document.addEventListener(type, motion, true);
  return {
    glass,
    stop() {
      unsubscribe();
      mutations.disconnect();
      for (const type of MOTION_EVENTS) document.removeEventListener(type, motion, true);
      if (registry === glass) {
        registry = null;
        announceAvailability();
      }
    },
  };
}

export function useGlassPanel(ref: RefObject<Element | null>, enabled = true) {
  const available = useGlassAvailable();
  useLayoutEffect(() => {
    const element = ref.current;
    return enabled && available && element && registry ? registry.add(element) : undefined;
  }, [enabled, available]);
}

export function useGlassSurface(ref: RefObject<Element | null>, fill: string | undefined, enabled: boolean) {
  const available = useGlassAvailable();
  useLayoutEffect(() => {
    const element = ref.current;
    const glass = registry;
    if (!enabled || !available || !element || !glass || !fill) return;
    const html = element as HTMLElement;
    element.setAttribute(GLASS_ID_ATTRIBUTE, "");
    html.style.setProperty(GLASS_FILL_PROPERTY, glassFill(fill));
    const remove = glass.add(element);
    return () => {
      remove();
      html.style.removeProperty(GLASS_FILL_PROPERTY);
      element.removeAttribute(GLASS_ID_ATTRIBUTE);
      element.removeAttribute(GLASS_ATTRIBUTE);
    };
  }, [enabled, available, fill]);
}

export function useVisualEffectMark(ref: RefObject<Element | null>) {
  useLayoutEffect(() => {
    ref.current?.setAttribute(VISUAL_EFFECT_ATTRIBUTE, "");
  }, []);
}
