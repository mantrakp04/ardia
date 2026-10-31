import { useEffect, useRef, useState } from "react";
import { Animated, AppState } from "react-native";
import { ARC_PEEK_OUT_MS, ARC_PEEK_SPRING, easeInOutCubic } from "./dockMotion";
import { spring, curve } from "../ui/motion";
import { backgroundInstance } from "../../state/app/appSettings";

const SLIDE_MS = 180;
const HIDE_DELAY_MS = 120;
const ARC_IN = spring(ARC_PEEK_SPRING);
const appInFront = () => backgroundInstance || AppState.currentState === "active";

export function usePeek(enabled: boolean, arc = false, held: () => boolean = () => false, onSlideOut: () => void = () => {}) {
  const slide = useRef(new Animated.Value(0)).current;
  const [live, setLive] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const heldBack = useRef(false);
  const out = useRef(false);
  const waitingForFocus = useRef(false);
  const animate = (to: number, done?: () => void) =>
    (arc
      ? to > 0
        ? Animated.spring(slide, { toValue: to, ...ARC_IN, restDisplacementThreshold: 0.001, restSpeedThreshold: 0.01, useNativeDriver: true })
        : Animated.timing(slide, { toValue: to, duration: ARC_PEEK_OUT_MS, easing: easeInOutCubic, useNativeDriver: true })
      : Animated.timing(slide, { toValue: to, duration: SLIDE_MS, easing: curve.outCubic, useNativeDriver: true })
    ).start(({ finished }) => finished && done?.());
  const slideOut = () => {
    out.current = false;
    onSlideOut();
    animate(0, () => setLive(false));
  };
  const show = () => {
    clearTimeout(hideTimer.current);
    heldBack.current = false;
    if (!enabled) return;
    if (!out.current && !appInFront()) {
      waitingForFocus.current = true;
      return;
    }
    waitingForFocus.current = false;
    out.current = true;
    setLive(true);
    animate(1);
  };
  const cancelPending = (pointerStillAtEdge = false) => {
    waitingForFocus.current &&= pointerStillAtEdge;
  };
  const hide = () => {
    clearTimeout(hideTimer.current);
    if (!out.current) return cancelPending();
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
  const latestShow = useRef(show);
  latestShow.current = show;
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => state === "active" && waitingForFocus.current && latestShow.current());
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (enabled) return;
    waitingForFocus.current = false;
    clearTimeout(hideTimer.current);
    if (live) slideOut();
  }, [enabled]);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  return { slide, live, show, hide, recheck, cancelPending };
}
