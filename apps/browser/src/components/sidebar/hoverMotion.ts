import { useLayoutEffect, useRef, useState } from "react";
import { Animated } from "react-native";
import { spring, curve } from "../ui/motion";
import type { Anchor } from "../../state/sidebar/sidebarUi";
import { SIDEBAR_MOTION } from "./tokens";

export const HOVER_CARD_GAP = 8;
export const HOVER_CARD_FROM_SCALE = 0.92;
export const HOVER_CARD_FADE_MS = SIDEBAR_MOTION.hoverCardFade;
export const HOVER_CARD_IN_SPRING = { response: 0.25, damping: 0.75 } as const;
export const HOVER_CARD_OUT_SPRING = { response: 0.2, damping: 0.6 } as const;

const fade = curve.fade;

export function hoverCardOrigin(anchor: Anchor, edge = anchor.x + anchor.width): { left: number; top: number } {
  return { left: edge + HOVER_CARD_GAP, top: Math.max(8, anchor.y - 6) };
}

function createMotion() {
  const opacity = new Animated.Value(0);
  const scale = new Animated.Value(HOVER_CARD_FROM_SCALE);
  const dx = new Animated.Value(0);
  const dy = new Animated.Value(0);
  const shrink = Animated.subtract(1, scale);
  return {
    opacity,
    scale,
    dx,
    dy,
    style: { opacity, transform: [{ translateX: Animated.multiply(shrink, dx) }, { translateY: Animated.multiply(shrink, dy) }, { scale }] },
  };
}

export const hoverCardMotions = new Map<string, ReturnType<typeof createMotion>>();

export function useHoverCardMotion<T>(key: string, target: T | null) {
  const [motion] = useState(createMotion);
  const [drawn, setDrawn] = useState<T | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [entering, setEntering] = useState(false);
  const state = useRef({ drawn: null as T | null, leaving: false, run: 0, fade: 0 });

  useLayoutEffect(() => {
    if (!__DEV__) return;
    hoverCardMotions.set(key, motion);
    return () => void hoverCardMotions.delete(key);
  }, [key, motion]);

  useLayoutEffect(() => {
    const s = state.current;
    const run = ++s.run;
    if (target) {
      const fresh = !s.drawn;
      const returning = s.leaving;
      s.drawn = target;
      s.leaving = false;
      setDrawn(target);
      setLeaving(false);
      if (!fresh && !returning) return;
      if (fresh) {
        motion.opacity.setValue(0);
        motion.scale.setValue(HOVER_CARD_FROM_SCALE);
        setEntering(true);
      }
      const fadeIn = ++s.fade;
      Animated.timing(motion.opacity, { toValue: 1, duration: HOVER_CARD_FADE_MS, easing: fade, useNativeDriver: true }).start(({ finished }) => {
        if (finished && state.current.fade === fadeIn) setEntering(false);
      });
      Animated.spring(motion.scale, { toValue: 1, ...spring(HOVER_CARD_IN_SPRING), useNativeDriver: true }).start();
      return;
    }
    if (!s.drawn || s.leaving) return;
    s.leaving = true;
    s.fade++;
    setLeaving(true);
    Animated.spring(motion.scale, { toValue: HOVER_CARD_FROM_SCALE, ...spring(HOVER_CARD_OUT_SPRING), useNativeDriver: true }).start();
    Animated.timing(motion.opacity, { toValue: 0, duration: HOVER_CARD_FADE_MS, easing: fade, useNativeDriver: true }).start(({ finished }) => {
      if (!finished || state.current.run !== run) return;
      motion.scale.stopAnimation();
      state.current.drawn = null;
      state.current.leaving = false;
      setDrawn(null);
      setLeaving(false);
      setEntering(false);
    });
  }, [target]);

  useLayoutEffect(
    () => () => {
      motion.opacity.stopAnimation();
      motion.scale.stopAnimation();
    },
    [],
  );

  return { drawn, leaving, entering, motion };
}

export function useHoverCardPlacement(
  motion: ReturnType<typeof createMotion>,
  at: { left: number; top: number } | null,
  size: { width: number; height: number },
) {
  useLayoutEffect(() => {
    if (!at) return;
    motion.dx.setValue(at.left - size.width / 2);
    motion.dy.setValue(at.top - size.height / 2);
  }, [motion, at?.left, at?.top, size.width, size.height]);
}
