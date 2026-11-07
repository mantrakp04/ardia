import { useLayoutEffect, type RefObject } from "react";
import { hostSupports, INPUT_REGIONS_METHOD, invokeHost, reportHostError, type ArdiaHost } from "./host.ts";
import { createInputRegions, type InputRegionsRegistry, type RegionDeps, type RegionShape } from "./inputRegions.ts";
import { createPageHoles, type PageHoles } from "./pageHoles.ts";
import { startShellGlass } from "./shellGlass.ts";

export const SHELL_ABOVE_CLASS = "ardia-shell-above";
const MOTION_EVENTS = ["transitionrun", "transitionend", "transitioncancel", "animationstart", "animationend", "animationcancel"] as const;

let regions: InputRegionsRegistry | null = null;
let holes: PageHoles | null = null;
export const inputRegions = () => regions;
export const pageHoles = () => holes;
export const shellOverPages = () => regions !== null;

const concealed = new WeakMap<HTMLElement, string>();

export function domRegionDeps(host: ArdiaHost): Omit<RegionDeps, "conceal"> {
  return {
    send: hostSupports(INPUT_REGIONS_METHOD, host) ? (next) => invokeHost<void>(INPUT_REGIONS_METHOD, next, host) : null,
    viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
    rectOf: (element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    },
    receivesPointer: (element) => getComputedStyle(element).pointerEvents !== "none",
    watch: (element, changed) => {
      const mutations = new MutationObserver(changed);
      mutations.observe(element, { subtree: true, childList: true, attributes: true });
      for (let parent = element.parentElement; parent; parent = parent.parentElement) mutations.observe(parent, { attributes: true, attributeFilter: ["style", "class"] });
      for (const type of MOTION_EVENTS) element.addEventListener(type, changed);
      return () => {
        mutations.disconnect();
        for (const type of MOTION_EVENTS) element.removeEventListener(type, changed);
      };
    },
    animating: (elements) => !!document.getAnimations?.().some((animation) => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      return animation.playState === "running" && !!target && elements.some((element) => element.contains(target) || target.contains(element));
    }),
    microtask: (run) => queueMicrotask(run),
    frame: (run) => void requestAnimationFrame(run),
    frameTime: () => Number(document.timeline.currentTime ?? performance.now()),
    timeout: (run, ms) => setTimeout(run, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    report: reportHostError,
  };
}

function conceal(element: Element, hidden: boolean) {
  const node = element as HTMLElement;
  if (hidden && node.contains(document.activeElement)) return;
  if (hidden) {
    if (!concealed.has(node)) concealed.set(node, node.style.visibility);
    node.style.visibility = "hidden";
  } else if (concealed.has(node)) {
    node.style.visibility = concealed.get(node)!;
    concealed.delete(node);
  }
}

export function startShellAbove(host: ArdiaHost, root: HTMLElement = document.body) {
  document.documentElement.classList.add(SHELL_ABOVE_CLASS);
  const painter = createPageHoles(root);
  const glass = startShellGlass(host);
  const registry = createInputRegions({
    ...domRegionDeps(host),
    conceal,
    pagesChanged: (areas) => {
      painter.pagesChanged(areas);
      glass.glass.setPages(areas.map((area) => area.rect));
    },
  });
  holes = painter;
  regions = registry;
  const refresh = () => registry.refresh();
  window.addEventListener("resize", refresh);
  window.addEventListener("scroll", refresh, true);
  return () => {
    window.removeEventListener("resize", refresh);
    window.removeEventListener("scroll", refresh, true);
    document.documentElement.classList.remove(SHELL_ABOVE_CLASS);
    glass.stop();
    if (regions === registry) regions = null;
    if (holes === painter) holes = null;
  };
}

export function useInputRegion(ref: RefObject<Element | null>, shape: RegionShape = "box", gated = true) {
  useLayoutEffect(() => {
    const element = ref.current;
    return element && regions ? regions.addOverlay(element, shape, gated) : undefined;
  }, [shape, gated]);
}

export function usePageHoleLayer(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const element = ref.current;
    return element && holes ? holes.addLayer(element) : undefined;
  }, []);
}
