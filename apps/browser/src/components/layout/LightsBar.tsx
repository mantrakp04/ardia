import { setTrafficLightsCenter, WindowDragRegion } from "@ardia/shell";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet } from "react-native";
import { LIGHTS_BAR, lightsBarCenter, setLightsBarMoving } from "./dockMotion";

const EASE = Easing.inOut(Easing.sin);

export type LightsBar = { shown: Animated.Value; open: boolean; show(): void; hide(): void };

export function useLightsBar(windowId: string, enabled: boolean): LightsBar {
  const shown = useRef(new Animated.Value(0)).current;
  const [open, setOpen] = useState(false);
  const opened = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const slide = (to: 0 | 1) => {
    opened.current = to === 1;
    setOpen(to === 1);
    setLightsBarMoving(windowId, true);
    Animated.timing(shown, { toValue: to, duration: LIGHTS_BAR.ms, easing: EASE, useNativeDriver: false }).start(
      ({ finished }) => finished && setLightsBarMoving(windowId, false),
    );
  };
  const show = () => {
    clearTimeout(hideTimer.current);
    if (enabled && !opened.current) slide(1);
  };
  const hide = () => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => opened.current && slide(0), LIGHTS_BAR.hideDelayMs);
  };
  useEffect(() => {
    if (!enabled) return;
    let sent = "";
    const place = (value: number) => {
      const center = lightsBarCenter(value);
      const key = center.join(",");
      if (key === sent) return;
      sent = key;
      void setTrafficLightsCenter(windowId, center);
    };
    place((shown as unknown as { __getValue(): number }).__getValue());
    const listener = shown.addListener(({ value }) => place(value));
    return () => {
      shown.removeListener(listener);
      clearTimeout(hideTimer.current);
      shown.stopAnimation();
      shown.setValue(0);
      opened.current = false;
      setOpen(false);
      setLightsBarMoving(windowId, false);
      void setTrafficLightsCenter(windowId, null);
    };
  }, [windowId, enabled, shown]);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  return { shown, open, show, hide };
}

export function LightsBarZone({ bar, rest, right }: { bar: LightsBar; rest: number; right: Animated.AnimatedInterpolation<number> | number }) {
  return (
    <Animated.View
      onMouseEnter={bar.show}
      onMouseLeave={bar.hide}
      style={{ position: "absolute", left: 0, top: 0, right, height: bar.open ? LIGHTS_BAR.height : rest }}
    >
      <WindowDragRegion style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}
