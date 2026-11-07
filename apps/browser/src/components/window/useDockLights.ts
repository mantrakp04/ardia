import { useEffect, useRef } from "react";
import type { Animated } from "react-native";
import { setTrafficLightsCenter } from "../../state/windows/nativeWindow";
import { dockMoving, sidebarLightsCenter, TOP_STRIP_LIGHTS_CENTER } from "../../state/windows/dockMotion";
import { PEEK_ORIGIN } from "./dockMotion";

const valueOf = (v: Animated.Value) => (v as unknown as { __getValue(): number }).__getValue();

export function useTopStripLights(windowId: string, dock: Animated.Value, on: boolean, travel: number, open: boolean) {
  useEffect(() => {
    if (!on) return;
    const place = (value: number) => {
      if (!dockMoving(windowId)) return;
      const up = Math.round(travel * (1 - value) * 2) / 2;
      void setTrafficLightsCenter(windowId, [TOP_STRIP_LIGHTS_CENTER[0], TOP_STRIP_LIGHTS_CENTER[1] - up]);
    };
    place(valueOf(dock));
    const sub = dock.addListener(({ value }) => place(value));
    return () => dock.removeListener(sub);
  }, [windowId, dock, on, travel, open]);
}

export type SidebarLights = { width: number; peeking: boolean; fullscreen: boolean; lights: readonly [number, number]; right: boolean };

export function useSidebarLights(windowId: string, dock: Animated.Value, slide: Animated.Value, o: SidebarLights) {
  const values = useRef({ dock: 1, slide: 0 });
  const apply = useRef<() => void>(() => {});
  const sent = useRef<string | undefined>(undefined);
  apply.current = () => {
    const center = slidingCenter(o, values.current.dock, values.current.slide);
    const key = center.join(",");
    if (key === sent.current) return;
    sent.current = key;
    void setTrafficLightsCenter(windowId, center);
  };
  useEffect(() => {
    values.current.dock = valueOf(dock);
    const a = dock.addListener(({ value }) => {
      values.current.dock = value;
      apply.current();
    });
    apply.current();
    return () => {
      dock.removeListener(a);
      sent.current = undefined;
      void setTrafficLightsCenter(windowId, null);
    };
  }, [windowId, dock]);
  useEffect(() => {
    if (!o.peeking) return;
    const b = slide.addListener(({ value }) => {
      values.current.slide = value;
      apply.current();
    });
    return () => slide.removeListener(b);
  }, [slide, o.peeking]);
  useEffect(() => apply.current(), [o.width, o.peeking, o.fullscreen, o.lights, o.right]);
}

export function slidingCenter(o: SidebarLights, dock: number, slide: number) {
  const offset = o.fullscreen ? 0 : o.peeking ? (o.width + 12) * (1 - slide) - PEEK_ORIGIN[0] : o.width * (1 - dock);
  return sidebarLightsCenter(o.right && !o.fullscreen, o.width, offset, o.peeking && !o.fullscreen ? PEEK_ORIGIN[1] : 0, o.lights);
}
