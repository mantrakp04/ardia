import type { ScrollView } from "react-native";

const views = new Map<string, ScrollView>();
export function registerBriefView(windowId: string, view: ScrollView | null) {
  if (view) views.set(windowId, view);
  else views.delete(windowId);
}
export function scrollBrief(windowId: string, y: number) {
  const view = views.get(windowId);
  if (!view) return false;
  view.scrollTo({ y, animated: false });
  return true;
}

type HoverProbe = { hovered: boolean; measure: () => Promise<number[]> };
const hoverProbes = new Map<string, HoverProbe>();
export function registerBriefHover(key: string, probe: HoverProbe) {
  hoverProbes.set(key, probe);
  return () => {
    if (hoverProbes.get(key) === probe) hoverProbes.delete(key);
  };
}
export async function briefHoverSnapshot() {
  return Promise.all([...hoverProbes].map(async ([key, probe]) => ({ key, hovered: probe.hovered, frame: await probe.measure() })));
}
