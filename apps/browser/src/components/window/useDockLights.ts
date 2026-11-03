import { useEffect, useRef } from "react";
import type { Animated } from "react-native";
import { setTrafficLightsCenter } from "../../state/windows/nativeWindow";
import { dockMoving, lightsCenter, TOP_STRIP_LIGHTS_CENTER } from "../../state/windows/dockMotion";
import { STRIP_HEIGHT } from "../../state/windows/toolbarAutoHide";
import { layout } from "../ui/theme";
import { usePaneChrome } from "../toolbar/WindowToolbar";
import { PEEK_ORIGIN } from "./dockMotion";

const valueOf = (v: Animated.Value) => (v as unknown as { __getValue(): number }).__getValue();

const COLLAPSED_LIGHTS_Y = layout.cardInset + STRIP_HEIGHT / 2;

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

export type SidebarLights = { width: number; peeking: boolean; fullscreen: boolean; lights: readonly [number, number]; fixed: boolean; followToolbar: boolean };

export function useSidebarLights(windowId: string, dock: Animated.Value, slide: Animated.Value, o: SidebarLights) {
  const values = useRef({ dock: 1, slide: 0, bar: 0 });
  const apply = useRef<() => void>(() => {});
  const sent = useRef<string | undefined>(undefined);
  const toolbar = usePaneChrome(windowId)?.bar;
  apply.current = () => {
    const v = values.current;
    const center = o.fixed ? fixedCenter(o, v.bar) : slidingCenter(o, v.dock, v.slide);
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
    if (!o.peeking || o.fixed) return;
    const b = slide.addListener(({ value }) => {
      values.current.slide = value;
      apply.current();
    });
    return () => slide.removeListener(b);
  }, [slide, o.peeking, o.fixed]);
  useEffect(() => {
    values.current.bar = 0;
    if (!toolbar || !o.followToolbar) return apply.current();
    values.current.bar = valueOf(toolbar);
    const c = toolbar.addListener(({ value }) => {
      values.current.bar = value;
      apply.current();
    });
    apply.current();
    return () => toolbar.removeListener(c);
  }, [toolbar, o.followToolbar]);
  useEffect(() => apply.current(), [o.width, o.peeking, o.fullscreen, o.lights, o.fixed]);
}

function slidingCenter(o: SidebarLights, dock: number, slide: number): [number, number] {
  const offset = o.fullscreen ? 0 : o.peeking ? (o.width + 12) * (1 - slide) - PEEK_ORIGIN[0] : o.width * (1 - dock);
  return lightsCenter(offset, o.peeking && !o.fullscreen ? PEEK_ORIGIN[1] : 0, o.lights);
}

function fixedCenter(o: SidebarLights, bar: number): [number, number] {
  const y = o.fullscreen ? o.lights[1] : o.lights[1] + (COLLAPSED_LIGHTS_Y - o.lights[1]) * Math.min(1, Math.max(0, bar));
  return [o.lights[0], Math.round(y * 2) / 2];
}
