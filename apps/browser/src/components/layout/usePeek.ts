import { useEffect, useRef, useState } from "react";
import { Animated, Easing } from "react-native";
import { ARC_PEEK_OUT_MS, ARC_PEEK_SPRING, easeInOutCubic, springConfig } from "./dockMotion";

const SLIDE_MS = 180;
const HIDE_DELAY_MS = 120;
const ARC_IN = springConfig(ARC_PEEK_SPRING);

export function usePeek(enabled: boolean, arc = false, held: () => boolean = () => false, onSlideOut: () => void = () => {}) {
  const slide = useRef(new Animated.Value(0)).current;
  const [live, setLive] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const heldBack = useRef(false);
  const animate = (to: number, done?: () => void) =>
    (arc
      ? to > 0
        ? Animated.spring(slide, { toValue: to, ...ARC_IN, restDisplacementThreshold: 0.001, restSpeedThreshold: 0.01, useNativeDriver: true })
        : Animated.timing(slide, { toValue: to, duration: ARC_PEEK_OUT_MS, easing: easeInOutCubic, useNativeDriver: true })
      : Animated.timing(slide, { toValue: to, duration: SLIDE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true })
    ).start(({ finished }) => finished && done?.());
  const slideOut = () => {
    onSlideOut();
    animate(0, () => setLive(false));
  };
  const show = () => {
    clearTimeout(hideTimer.current);
    heldBack.current = false;
    if (!enabled) return;
    setLive(true);
    animate(1);
  };
  const hide = () => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      heldBack.current = held();
      if (!heldBack.current) slideOut();
    }, HIDE_DELAY_MS);
  };
  const recheck = () => {
    if (!heldBack.current || held()) return;
    heldBack.current = false;
    hide();
  };
  useEffect(() => {
    if (enabled) return;
    clearTimeout(hideTimer.current);
    if (live) slideOut();
  }, [enabled]);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  return { slide, live, show, hide, recheck };
}
