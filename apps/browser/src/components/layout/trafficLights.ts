import { canFadeTrafficLights, cardNotchDrivesLights, setTrafficLightsAlpha } from "@ardia/shell";
import { useEffect, useRef, type MutableRefObject } from "react";
import { create } from "zustand";
import { ARC_LIGHTS_CENTER, ARC_PEEK_OUT_MS } from "./dockMotion";
import { LIGHTS_HIDDEN_OFFSET } from "./lightsCorner";
import type { SidebarSide } from "./sidebarMove";

const FADE_IN_MS = 100;
const NOTCH_DRIVEN = -1;
const RESTING = ARC_LIGHTS_CENTER.join(",");
const awayFromRest = (key: string | undefined) => key !== RESTING;

export type LightsRevealState = "live" | "off";

export const useLightsReveals = create<Record<string, LightsRevealState>>()(() => ({}));

export function setLightsReveal(windowId: string, reveal: LightsRevealState | null) {
  const current = useLightsReveals.getState();
  if ((current[windowId] ?? null) === reveal) return;
  const { [windowId]: _, ...rest } = current;
  useLightsReveals.setState(reveal === null ? rest : { ...current, [windowId]: reveal }, true);
}

export const useSideSwitches = create<Record<string, SidebarSide>>()(() => ({}));

export function setSideSwitching(windowId: string, to: SidebarSide | null) {
  const current = useSideSwitches.getState();
  if ((current[windowId] ?? null) === to) return;
  const { [windowId]: _, ...rest } = current;
  useSideSwitches.setState(to ? { ...current, [windowId]: to } : rest, true);
}

export function useFixedLights(windowId: string, fixed: boolean, sent: MutableRefObject<string | undefined>): { offset: number | null; held: boolean } {
  const state = useLightsReveals((r) => r[windowId] ?? "live");
  const notchDrives = fixed && cardNotchDrivesLights && state === "live";
  const shown = !notchDrives;
  const switchingTo = useSideSwitches((r) => r[windowId]);
  const switching = !!switchingTo;
  const hiddenOnArrival = notchDrives || (switchingTo === "right" && cardNotchDrivesLights);
  const fades = useRef(canFadeTrafficLights()).current;
  const sentAlpha = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!fades) return;
    if (switching) {
      const alpha = hiddenOnArrival ? 0 : 1;
      if (alpha === Math.max(0, sentAlpha.current ?? 1)) return;
      sentAlpha.current = alpha;
      setTrafficLightsAlpha(windowId, alpha, alpha ? FADE_IN_MS : ARC_PEEK_OUT_MS);
      return;
    }
    const first = sentAlpha.current === undefined;
    if (notchDrives) {
      if (first || awayFromRest(sent.current)) setTrafficLightsAlpha(windowId, 0);
      sentAlpha.current = NOTCH_DRIVEN;
      return;
    }
    const alpha = shown ? 1 : 0;
    if (alpha === sentAlpha.current) return;
    sentAlpha.current = alpha;
    if (first && alpha === 1) return;
    setTrafficLightsAlpha(windowId, alpha, first ? 0 : alpha ? FADE_IN_MS : ARC_PEEK_OUT_MS);
  }, [windowId, shown, notchDrives, switching, hiddenOnArrival]);
  useEffect(
    () => () => {
      if (sentAlpha.current !== undefined && sentAlpha.current < 1) setTrafficLightsAlpha(windowId, 1);
      sentAlpha.current = undefined;
    },
    [windowId],
  );
  return { offset: !fixed ? null : !fades && !shown ? LIGHTS_HIDDEN_OFFSET : 0, held: switching };
}
