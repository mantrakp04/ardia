import { onWindowEvent, setTrafficLightsCenter, Surface, watchLeftEdge, watchRightEdge, WindowDragRegion } from "@ardia/shell";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { switchOn } from "../../lib/killSwitches";
import { hex, layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import { Sidebar } from "../Sidebar";
import { dismissHoverIn } from "../sidebar/hover";
import { useSidebarUi } from "../sidebar/state";
import { useSidebarOnRight } from "../sidebar/tokens";
import { peekHeld, watchPeekHolds } from "./peekHold";
import { ProfileSwipe } from "./ProfileSwipe";
import {
  ARC_HIDE_MS,
  ARC_LIGHTS_CENTER,
  devPeeks,
  DOCK_SPRING,
  LIGHTS_CENTER,
  lightsCenter,
  PEEK_BOTTOM,
  PEEK_ORIGIN,
  PEEK_RADIUS,
  peekShown,
  setDockMoving,
  setPeekShown,
  springConfig,
  useDockMotion,
} from "./dockMotion";
import { useTabDrag } from "./tabDrag";
import { setSideSwitching, useFixedLights } from "./trafficLights";
import { outgoingSide, SWITCH_LIMIT_MS } from "./sidebarMove";
import { usePeek } from "./usePeek";
import { LightsReveal } from "./LightsReveal";

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled().then(
  (on) => (reduceMotion = on),
  () => {},
);
AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => (reduceMotion = on));

const SPRING = springConfig(DOCK_SPRING);
const NATIVE_SPRING = { ...SPRING, restDisplacementThreshold: 0.5, restSpeedThreshold: 5, useNativeDriver: true } as const;
const STRIP_WIDTH = 8;
const HOLD_SLACK = 24;
const SWITCH_OUT_MS = 120;
const SWITCH_HAND_OFF = 0.6;

const devDocks: Record<string, unknown> = {};
if (__DEV__) (globalThis as { acDocks?: typeof devDocks }).acDocks = devDocks;

const slides = (animate: boolean) => animate && !reduceMotion && switchOn("sidebarSlide");

function useSidebarDock(open: boolean, animate: boolean, arc: boolean): Animated.Value {
  const windowId = useWindowId();
  const dock = useRef(new Animated.Value(open ? 1 : 0)).current;
  const was = useRef(open);
  useEffect(() => {
    if (was.current === open) return;
    was.current = open;
    if (!animate || reduceMotion || !switchOn("sidebarSlide")) {
      dock.stopAnimation();
      dock.setValue(open ? 1 : 0);
      setDockMoving(windowId, false);
      return;
    }
    if (arc && open && peekShown(windowId)) {
      dock.stopAnimation();
      dock.setValue(1);
      setDockMoving(windowId, false);
      return;
    }
    setDockMoving(windowId, true);
    (arc && !open
      ? Animated.timing(dock, { toValue: 0, duration: ARC_HIDE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false })
      : Animated.spring(dock, {
          toValue: open ? 1 : 0,
          ...SPRING,
          restDisplacementThreshold: 0.001,
          restSpeedThreshold: 0.01,
          useNativeDriver: false,
        })
    ).start(({ finished }) => finished && setDockMoving(windowId, false));
  }, [open]);
  useEffect(() => () => setDockMoving(windowId, false), []);
  return dock;
}

type Inset = { top: number; right: number; bottom: number; left: number };

type Sides = { setting: boolean; arc: boolean; outFrom: boolean | null; docked: boolean; phase: "out" | "in" | null };

const cardX = (right: boolean, open: boolean, width: number, inset: Inset) => (open && !right ? width : inset.left);

function useSideSwitch({
  windowId,
  toRight,
  arc,
  sidebarOpen,
  animate,
  width,
  inset,
  peeking,
}: {
  windowId: string;
  toRight: boolean;
  arc: boolean;
  sidebarOpen: boolean;
  animate: boolean;
  width: number;
  inset: Inset;
  peeking: () => boolean;
}) {
  const shifts = useRef({ card: new Animated.Value(0), sidebar: new Animated.Value(0) }).current;
  const [sides, setSides] = useState<Sides>({ setting: toRight, arc, outFrom: null, docked: false, phase: null });
  const docked = sides.phase !== null && sides.docked;
  const relaidOut = sides.arc !== arc;
  if (sides.setting !== toRight || relaidOut || (!animate && sides.phase !== null)) {
    if (docked || !animate || relaidOut) setSides({ setting: toRight, arc, outFrom: null, docked: false, phase: null });
    else {
      const outFrom = outgoingSide(sides.outFrom, sides.setting, { visible: sidebarOpen || peeking(), slides: slides(animate) });
      const started = sides.outFrom === null && outFrom !== null;
      setSides({ setting: toRight, arc, outFrom, docked: started ? sidebarOpen : sides.docked, phase: outFrom === null ? null : "out" });
    }
  } else if (docked && !sidebarOpen) setSides({ ...sides, outFrom: null, docked: false, phase: null });
  const settle = () => setSides((v) => ({ ...v, outFrom: null, phase: null }));
  const handOff = () => setSides((v) => (v.phase === "out" ? { ...v, outFrom: null, phase: v.docked ? "in" : null } : v));
  const phase = docked ? sides.phase : null;
  useLayoutEffect(() => {
    setSideSwitching(windowId, phase === null ? null : toRight ? "right" : "left");
    if (phase !== "in") setDockMoving(windowId, phase === "out");
    if (phase !== "out") {
      if (phase === null) {
        shifts.card.stopAnimation();
        shifts.sidebar.stopAnimation();
        shifts.card.setValue(0);
        shifts.sidebar.setValue(0);
      }
      return;
    }
    const from = sides.outFrom!;
    shifts.card.setValue(cardX(from, true, width, inset) - cardX(toRight, true, width, inset));
    shifts.sidebar.setValue(0);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      Animated.spring(shifts.card, { toValue: 0, ...NATIVE_SPRING }).start();
      Animated.timing(shifts.sidebar, { toValue: from ? width : -width, duration: SWITCH_OUT_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      timer = setTimeout(() => {
        shifts.sidebar.setValue(toRight ? width : -width);
        handOff();
      }, SWITCH_OUT_MS * SWITCH_HAND_OFF);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [phase]);
  useLayoutEffect(() => {
    if (phase !== "in") return;
    Animated.spring(shifts.sidebar, { toValue: 0, ...NATIVE_SPRING }).start(({ finished }) => finished && settle());
  }, [phase]);
  useEffect(() => () => setSideSwitching(windowId, null), [windowId]);
  useEffect(() => {
    if (sides.phase === null) return;
    const limit = setTimeout(settle, SWITCH_LIMIT_MS);
    return () => clearTimeout(limit);
  }, [sides.phase]);
  return { sides, docked, shifts, handOff };
}

export function DockedLayout({
  fullscreen,
  topTabs,
  inset,
  children,
}: {
  fullscreen: boolean;
  topTabs: boolean;
  inset: Inset;
  children: ReactNode;
}) {
  const windowId = useWindowId();
  const [open, savedWidth, addressBar] = useBrowser(
    useShallow(
      (s) =>
        [
          s.windows[windowId]?.sidebarOpen ?? true,
          s.settings.sidebarWidth ?? layout.sidebarWidth,
          s.settings.addressBar === "sidebar",
        ] as const,
    ),
  );
  const toRight = useSidebarOnRight(windowId);
  const width = useSidebarUi((u) => u.dragWidth[windowId]) ?? savedWidth;
  const arc = addressBar && !topTabs && switchOn("sidebarSlide");
  const { sides, docked, shifts, handOff } = useSideSwitch({ windowId, toRight, arc, sidebarOpen: open, animate: !topTabs && !fullscreen, width, inset, peeking: () => peekShown(windowId) });
  const right = sides.outFrom ?? toRight;
  const lights = addressBar && !topTabs ? ARC_LIGHTS_CENTER : LIGHTS_CENTER;
  const dock = useSidebarDock(open, !topTabs && !fullscreen, arc);
  const left = useMemo(
    () =>
      dock.interpolate({
        inputRange: [0, 1],
        outputRange: [inset.left, right ? inset.left : width],
      }),
    [dock, width, inset.left, right],
  );
  const rightPadding = useMemo(() => dock.interpolate({ inputRange: [0, 1], outputRange: [inset.right, width] }), [dock, width, inset.right]);
  const paddingRight = docked ? (toRight ? width : inset.right) : right ? rightPadding : inset.right;
  const paddingLeft = topTabs ? inset.left : docked ? cardX(toRight, true, width, inset) : left;
  const padded = useRef<View>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (mounted.current && !fullscreen) padded.current?.setNativeProps({ style: { paddingLeft: currentValue(paddingLeft), paddingRight: currentValue(paddingRight) } });
    mounted.current = true;
  }, [right, toRight, docked]);
  if (__DEV__) devDocks[windowId] = { dock, left, rightPadding, shifts, docked, right, toRight, width };
  return (
    <>
      <Animated.View
        ref={padded}
        style={
          fullscreen
            ? { flex: 1 }
            : {
                flex: 1,
                flexDirection: "row",
                paddingTop: inset.top,
                paddingRight,
                paddingBottom: inset.bottom,
                paddingLeft,
              }
        }
      >
        {!fullscreen && <WindowDragRegion style={StyleSheet.absoluteFill} />}
        <Animated.View style={{ flex: 1, flexDirection: fullscreen ? "column" : "row", transform: [{ translateX: shifts.card }] }}>{children}</Animated.View>
      </Animated.View>
      {!topTabs && (
        <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { transform: [{ translateX: shifts.sidebar }] }]}>
          <SidebarDock
            dock={dock}
            open={open}
            width={width}
            fullscreen={fullscreen}
            arc={arc}
            lights={lights}
            right={right}
            peekOut={sides.phase === "out" && !sides.docked}
            onPeekOut={handOff}
          />
        </Animated.View>
      )}
      {right && <LightsReveal enabled={!fullscreen} />}
    </>
  );
}

const currentValue = (v: number | Animated.AnimatedInterpolation<number>) => (typeof v === "number" ? v : (v as unknown as { __getValue(): number }).__getValue());

function SidebarDock({
  dock,
  open,
  width,
  fullscreen,
  arc,
  lights,
  right,
  peekOut,
  onPeekOut,
}: {
  dock: Animated.Value;
  open: boolean;
  width: number;
  fullscreen: boolean;
  arc: boolean;
  lights: readonly [number, number];
  right: boolean;
  peekOut: boolean;
  onPeekOut: () => void;
}) {
  const theme = useTheme();
  const windowId = useWindowId();
  const moving = useDockMotion((m) => !!m.moving[windowId]);
  const edgeOver = useRef(false);
  const peek = usePeek(!open && !moving && !fullscreen && !peekOut, arc, () => edgeOver.current || peekHeld(windowId), () => dismissHoverIn(windowId));
  const latestPeek = useRef(peek);
  latestPeek.current = peek;
  useEffect(() => (peek.live ? watchPeekHolds(() => latestPeek.current.recheck()) : undefined), [peek.live]);
  const holdWidth = PEEK_ORIGIN[0] + width + HOLD_SLACK;
  const holdHeight = useRef(Infinity);
  const inHold = (x: number, y: number) =>
    (right ? x >= STRIP_WIDTH - holdWidth && x < STRIP_WIDTH : x >= 0 && x < holdWidth) && y >= 0 && y < holdHeight.current;
  const peeking = !open && !fullscreen && peek.live;
  const shown = fullscreen ? "fullscreen" : open ? "docked" : peek.live ? "peek" : "away";
  useLayoutEffect(() => () => dismissHoverIn(windowId), [windowId, shown]);
  const watching = !open && !fullscreen && !moving;
  const draggingTab = useTabDrag((d) => d.windowId === windowId && d.tabIds.length > 0);
  const nativeHold = peeking ? holdWidth : draggingTab ? STRIP_WIDTH : 0;
  useEffect(() => {
    if (!watching) return;
    const sub = onWindowEvent((e) => {
      if (e.type !== (right ? "rightEdge" : "leftEdge") || e.id !== windowId) return;
      edgeOver.current = e.over;
      if (e.over) latestPeek.current.show();
      else latestPeek.current.hide();
    });
    const watchEdge = right ? watchRightEdge : watchLeftEdge;
    watchEdge(windowId, true, nativeHold);
    return () => {
      sub.remove();
      watchEdge(windowId, false);
      edgeOver.current = false;
    };
  }, [windowId, watching, nativeHold, right]);
  const areaWidth = useRef(0);
  const showPeekSpan = (live: boolean) =>
    right
      ? setPeekShown(windowId, live, Infinity, areaWidth.current - PEEK_ORIGIN[0] - width)
      : setPeekShown(windowId, live, PEEK_ORIGIN[0] + width);
  useEffect(() => showPeekSpan(peek.live), [windowId, peek.live, width, right]);
  useEffect(() => {
    if (peekOut && !peek.live) onPeekOut();
  }, [peekOut, peek.live]);
  if (__DEV__) devPeeks[windowId] = peek;
  useEffect(() => () => setPeekShown(windowId, false), [windowId]);
  const panel = useRef(false);
  if (peeking) panel.current = true;
  const away = fullscreen || (!open && !moving && !peek.live);
  const slideOut = useMemo(() => dock.interpolate({ inputRange: [0, 1], outputRange: [right ? width : -width, 0] }), [dock, width, right]);
  const peekIn = useMemo(
    () => peek.slide.interpolate({ inputRange: [0, 1], outputRange: right ? [12, -width] : [-12, width] }),
    [peek.slide, width, right],
  );
  useTrafficLights(windowId, dock, peek.slide, { width, peeking, fullscreen, lights, fixed: right });
  const sidebar = useMemo(
    () => (
      <ProfileSwipe>
        <Sidebar width={width} />
      </ProfileSwipe>
    ),
    [width],
  );

  const leaveStrip = (e: { nativeEvent: { clientX: number; clientY: number } }) => {
    if (peek.live && !inHold(e.nativeEvent.clientX, e.nativeEvent.clientY)) peek.hide();
  };

  const strip = useRef(false);
  if (!open) strip.current = true;
  const fade = peeking && !arc;
  const panelOn = useRef(new Animated.Value(0)).current;
  useLayoutEffect(() => panelOn.setValue(peeking ? 1 : 0), [panelOn, peeking]);
  const panelOpacity = useMemo(
    () => (arc ? panelOn : Animated.multiply(panelOn, peek.slide)),
    [arc, panelOn, peek.slide],
  );
  const peekStyle = {
    opacity: fade ? peek.slide : 1,
    transform: [{ translateX: peeking ? peekIn : 0 }],
  };

  return (
    <>
      {peeking && (
        <View
          pointerEvents="none"
          onMouseEnter={peek.show}
          onMouseLeave={peek.hide}
          onLayout={(e) => (holdHeight.current = e.nativeEvent.layout.height)}
          style={{ position: "absolute", [right ? "right" : "left"]: 0, top: 0, bottom: 0, width: holdWidth }}
        />
      )}
      {strip.current && (
        <View
          pointerEvents={!open && !fullscreen ? "auto" : "none"}
          onMouseEnter={peek.show}
          onMouseLeave={leaveStrip}
          onLayout={
            right
              ? (e) => {
                  const { x, width: stripWidth } = e.nativeEvent.layout;
                  areaWidth.current = x + stripWidth;
                  if (peek.live) showPeekSpan(true);
                }
              : undefined
          }
          style={{
            position: "absolute",
            [right ? "right" : "left"]: 0,
            top: 0,
            bottom: layout.cardInset,
            width: !open && !fullscreen ? STRIP_WIDTH : 0,
          }}
        />
      )}
      <Animated.View
        pointerEvents={fullscreen || moving || (!open && !peeking) ? "none" : "auto"}
        style={{
          position: "absolute",
          ...(right
            ? away
              ? { left: -10_000 }
              : { right: peeking ? PEEK_ORIGIN[0] : 0 }
            : { left: away ? -10_000 : peeking ? PEEK_ORIGIN[0] : 0 }),
          top: peeking ? PEEK_ORIGIN[1] : 0,
          bottom: peeking ? PEEK_BOTTOM : 0,
          width,
          transform: [{ translateX: slideOut }],
        }}
      >
        {panel.current && (
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, peekStyle, { opacity: panelOpacity }]}
          >
            <Surface
              fill={hex(theme.windowTint[0])}
              cornerRadius={PEEK_RADIUS}
              borderColor={hex(theme.panelBorder)}
              borderWidth={0.5}
              shadowColor="#000000"
              shadowOpacity={theme.panelShadowOpacity}
              shadowRadius={20}
              shadowOffset={[0, 6]}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        )}
        <Animated.View style={[{ flex: 1 }, peekStyle, peeking ? { borderRadius: PEEK_RADIUS, overflow: "hidden" } : null]}>
          {sidebar}
        </Animated.View>
      </Animated.View>
    </>
  );
}

function useTrafficLights(
  windowId: string,
  dock: Animated.Value,
  slide: Animated.Value,
  o: { width: number; peeking: boolean; fullscreen: boolean; lights: readonly [number, number]; fixed: boolean },
) {
  const values = useRef({ dock: 1, slide: 0 });
  const apply = useRef<() => void>(() => {});
  const sent = useRef<string | undefined>(undefined);
  const fixed = useFixedLights(windowId, o.fixed, sent);
  apply.current = () => {
    if (fixed.held) return;
    const v = values.current;
    const offset = fixed.offset ?? (o.fullscreen ? 0 : o.peeking ? (o.width + 12) * (1 - v.slide) - PEEK_ORIGIN[0] : o.width * (1 - v.dock));
    const center = lightsCenter(offset, o.peeking && !o.fullscreen && !o.fixed ? PEEK_ORIGIN[1] : 0, o.lights);
    const key = center ? center.join(",") : "";
    if (key === sent.current) return;
    sent.current = key;
    void setTrafficLightsCenter(windowId, center);
  };
  useEffect(() => {
    values.current.dock = (dock as unknown as { __getValue(): number }).__getValue();
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
  useEffect(() => apply.current(), [o.width, o.peeking, o.fullscreen, o.lights, o.fixed, fixed.offset, fixed.held]);
}
