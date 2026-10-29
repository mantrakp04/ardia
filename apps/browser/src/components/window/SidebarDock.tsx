import { onWindowEvent, setTrafficLightsCenter, watchSidebarEdge } from "../../state/windows/nativeWindow";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { switchOn } from "../../state/app/switches";
import { layout, useTheme } from "../ui/theme";
import { spring, curve } from "../ui/motion";
import { Panel, reduceMotion, WindowDragRegion } from "../ui";
import { SHADOWS } from "./tokens";
import { useWindowId } from "../../state/browser/hooks";
import { useSidebarDockState } from "../../state/windows/hooks";
import { useToolbarLightsCenter } from "../../state/windows/layout";
import { Sidebar } from "../sidebar/Sidebar";
import { dismissHoverIn } from "../../state/sidebar/hover";
import { useSidebarUi } from "../../state/sidebar/sidebarUi";
import { peekHeld, watchHolds } from "../../state/app/transientUi";
import { ProfileSwipe } from "./ProfileSwipe";
import {
  ARC_HIDE_MS,
  DOCK_SPRING,
  PEEK_BOTTOM,
  PEEK_ORIGIN,
  PEEK_RADIUS,
  dockedCardLeft,
} from "./dockMotion";
import {
  ARC_LIGHTS_CENTER,
  devPeeks,
  dockMoving,
  lightsCenter,
  peekShown,
  setDockMoving,
  setPeekShown,
  TOP_STRIP_LIGHTS_CENTER,
  useDockMotion,
} from "../../state/windows/dockMotion";
import { useTabDrag } from "../../state/drag/tabDrag";
import { usePeek } from "./usePeek";
import { LightsBarCover, LightsBarZone, useLightsBar } from "./LightsBar";
import type { SidebarSide } from "../../state/windows/layout";

const SPRING = spring(DOCK_SPRING);
const STRIP_WIDTH = 8;
const HOLD_SLACK = 24;

function useSidebarDock(open: boolean, animate: boolean, arc: boolean): { dock: Animated.Value; away: boolean } {
  const windowId = useWindowId();
  const dock = useRef(new Animated.Value(open ? 1 : 0)).current;
  const was = useRef(open);
  const [away, setAway] = useState(!open);
  useEffect(() => {
    if (was.current === open) return;
    was.current = open;
    if (!animate || reduceMotion() || !switchOn("sidebarSlide")) {
      dock.stopAnimation();
      dock.setValue(open ? 1 : 0);
      setDockMoving(windowId, false);
      setAway(!open);
      return;
    }
    if (arc && open && peekShown(windowId)) {
      dock.stopAnimation();
      dock.setValue(1);
      setDockMoving(windowId, false);
      setAway(false);
      return;
    }
    if (open) setAway(false);
    setDockMoving(windowId, true);
    (arc && !open
      ? Animated.timing(dock, { toValue: 0, duration: ARC_HIDE_MS, easing: curve.outCubic, useNativeDriver: false })
      : Animated.spring(dock, {
          toValue: open ? 1 : 0,
          ...SPRING,
          restDisplacementThreshold: 0.001,
          restSpeedThreshold: 0.01,
          useNativeDriver: false,
        })
    ).start(({ finished }) => {
      if (!finished) return;
      setDockMoving(windowId, false);
      if (!open) setAway(true);
    });
  }, [open]);
  useEffect(() => () => setDockMoving(windowId, false), []);
  return { dock, away };
}

function useTopStripLights(windowId: string, dock: Animated.Value, on: boolean, travel: number, open: boolean) {
  useEffect(() => {
    if (!on) return;
    const place = (value: number) => {
      if (!dockMoving(windowId)) return;
      const up = Math.round(travel * (1 - value) * 2) / 2;
      void setTrafficLightsCenter(windowId, [TOP_STRIP_LIGHTS_CENTER[0], TOP_STRIP_LIGHTS_CENTER[1] - up]);
    };
    place((dock as unknown as { __getValue(): number }).__getValue());
    const sub = dock.addListener(({ value }) => place(value));
    return () => dock.removeListener(sub);
  }, [windowId, dock, on, travel, open]);
}

type Inset = { top: number; right: number; bottom: number; left: number };

export function DockedLayout({
  fullscreen,
  topTabs,
  inset,
  topStrip,
  windowWidth,
  children,
}: {
  fullscreen: boolean;
  topTabs: boolean;
  inset: Inset;
  topStrip?: { strip: ReactNode; peek: ReactNode };
  windowWidth: number;
  children: ReactNode;
}) {
  const windowId = useWindowId();
  const [open, sidebarWidth, addressBar, side] = useSidebarDockState(windowId);
  const width = useSidebarUi((u) => u.dragWidth[windowId]) ?? sidebarWidth;
  const arc = addressBar && !topTabs && switchOn("sidebarSlide");
  const toolbarLights = useToolbarLightsCenter();
  const lights = addressBar && !topTabs ? ARC_LIGHTS_CENTER : toolbarLights;
  const { dock, away } = useSidebarDock(open, !fullscreen, arc);
  const right = side === "right" && !topTabs;
  const bar = useLightsBar(windowId, right && !fullscreen);
  const rest = right ? inset.right : inset.left;
  const edge = useMemo(
    () =>
      dock.interpolate({
        inputRange: [0, 1],
        outputRange: [rest, dockedCardLeft(width)],
      }),
    [dock, width, rest],
  );
  const [height, setHeight] = useState(0);
  const top = useMemo(() => dock.interpolate({ inputRange: [0, 1], outputRange: [layout.cardInset, inset.top] }), [dock, inset.top]);
  const stripY = useMemo(() => dock.interpolate({ inputRange: [0, 1], outputRange: [-inset.top, 0] }), [dock, inset.top]);
  const stripShown = topTabs && (open || !away);
  const moving = useDockMotion((m) => !!m.moving[windowId]);
  useTopStripLights(windowId, dock, topTabs && !fullscreen, inset.top, open);
  return (
    <>
      <Animated.View
        onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
        style={
          fullscreen
            ? { flex: 1 }
            : {
                flex: 1,
                flexDirection: "row",
                paddingTop: topTabs ? top : inset.top,
                paddingRight: right ? edge : inset.right,
                paddingBottom: inset.bottom,
                paddingLeft: topTabs || right ? inset.left : edge,
              }
        }
      >
        {!fullscreen && <WindowDragRegion style={StyleSheet.absoluteFill} />}
        {children}
      </Animated.View>
      {topStrip &&
        stripShown && (
          <Animated.View
            pointerEvents={fullscreen || moving ? "none" : "auto"}
            style={[{ position: "absolute", left: 0, right: 0 }, fullscreen ? { bottom: "100%" } : { top: 0, transform: [{ translateY: stripY }] }]}
          >
            {topStrip.strip}
          </Animated.View>
        )}
      {topStrip && topTabs && !stripShown && topStrip.peek}
      {right && !fullscreen && <LightsBarCover bar={bar} right={edge} window={{ width: windowWidth, height }} inset={inset} />}
      {right && !fullscreen && <LightsBarZone bar={bar} rest={inset.top} right={edge} />}
      {!topTabs && (
        <SidebarDock
          dock={dock}
          open={open}
          width={width}
          fullscreen={fullscreen}
          arc={arc}
          lights={lights}
          side={right ? "right" : "left"}
          windowWidth={windowWidth}
        />
      )}
    </>
  );
}

function SidebarDock({
  dock,
  open,
  width,
  fullscreen,
  arc,
  lights,
  side,
  windowWidth,
}: {
  dock: Animated.Value;
  open: boolean;
  width: number;
  fullscreen: boolean;
  arc: boolean;
  lights: readonly [number, number];
  side: SidebarSide;
  windowWidth: number;
}) {
  const theme = useTheme();
  const windowId = useWindowId();
  const moving = useDockMotion((m) => !!m.moving[windowId]);
  const edgeOver = useRef(false);
  const peek = usePeek(!open && !moving && !fullscreen, arc, () => edgeOver.current || peekHeld(windowId), () => dismissHoverIn(windowId));
  const latestPeek = useRef(peek);
  latestPeek.current = peek;
  useEffect(() => (peek.live ? watchHolds("peek", () => latestPeek.current.recheck()) : undefined), [peek.live]);
  const right = side === "right";
  const mirror = right ? -1 : 1;
  const holdWidth = PEEK_ORIGIN[0] + width + HOLD_SLACK;
  const holdHeight = useRef(Infinity);
  const inHold = (x: number, y: number) =>
    (right ? x >= windowWidth - holdWidth && x < windowWidth : x >= 0 && x < holdWidth) && y >= 0 && y < holdHeight.current;
  const peeking = !open && !fullscreen && peek.live;
  const shown = fullscreen ? "fullscreen" : open ? "docked" : peek.live ? "peek" : "away";
  useLayoutEffect(() => () => dismissHoverIn(windowId), [windowId, shown]);
  const watching = !open && !fullscreen && !moving;
  const draggingTab = useTabDrag((d) => d.phase === "tab" && d.windowId === windowId);
  const nativeHold = peeking ? holdWidth : draggingTab ? STRIP_WIDTH : 0;
  useEffect(() => {
    if (!watching) return;
    const sub = onWindowEvent((e) => {
      if (e.type !== "sidebarEdge" || e.id !== windowId) return;
      edgeOver.current = e.over;
      if (e.over) latestPeek.current.show();
      else latestPeek.current.hide();
    });
    watchSidebarEdge(windowId, true, nativeHold, side);
    return () => {
      sub.remove();
      watchSidebarEdge(windowId, false, 0, side);
      edgeOver.current = false;
    };
  }, [windowId, watching, nativeHold, side]);
  useEffect(
    () =>
      right
        ? setPeekShown(windowId, peek.live, windowWidth - PEEK_ORIGIN[0] - width, Infinity)
        : setPeekShown(windowId, peek.live, -Infinity, PEEK_ORIGIN[0] + width),
    [windowId, peek.live, width, right, windowWidth],
  );
  if (__DEV__) devPeeks[windowId] = peek;
  useEffect(() => () => setPeekShown(windowId, false), [windowId]);
  const panel = useRef(false);
  if (peeking) panel.current = true;
  const away = fullscreen || (!open && !moving && !peek.live);
  const slideOut = useMemo(() => dock.interpolate({ inputRange: [0, 1], outputRange: [-width * mirror, 0] }), [dock, width, mirror]);
  const peekIn = useMemo(
    () => peek.slide.interpolate({ inputRange: [0, 1], outputRange: [-12 * mirror, width * mirror] }),
    [peek.slide, width, mirror],
  );
  useTrafficLights(windowId, dock, peek.slide, { width, peeking, fullscreen, lights, active: !right });
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
          style={{ position: "absolute", [side]: 0, top: 0, bottom: 0, width: holdWidth }}
        />
      )}
      {strip.current && (
        <View
          pointerEvents={!open && !fullscreen ? "auto" : "none"}
          onMouseEnter={peek.show}
          onMouseLeave={leaveStrip}
          style={{
            position: "absolute",
            [side]: 0,
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
          [side]: away ? -10_000 : peeking ? PEEK_ORIGIN[0] : 0,
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
            <Panel fill={right ? theme.windowTintTopRight : theme.windowTint[0]} radius={PEEK_RADIUS} border={theme.panelBorder} shadow={SHADOWS.sidebarPeek} style={StyleSheet.absoluteFill} />
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
  o: { width: number; peeking: boolean; fullscreen: boolean; lights: readonly [number, number]; active: boolean },
) {
  const values = useRef({ dock: 1, slide: 0 });
  const apply = useRef<() => void>(() => {});
  const sent = useRef<string | undefined>(undefined);
  apply.current = () => {
    const v = values.current;
    const offset = o.fullscreen ? 0 : o.peeking ? (o.width + 12) * (1 - v.slide) - PEEK_ORIGIN[0] : o.width * (1 - v.dock);
    const center = lightsCenter(offset, o.peeking && !o.fullscreen ? PEEK_ORIGIN[1] : 0, o.lights);
    const key = center ? center.join(",") : "";
    if (key === sent.current) return;
    sent.current = key;
    void setTrafficLightsCenter(windowId, center);
  };
  useEffect(() => {
    if (!o.active) return;
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
  }, [windowId, dock, o.active]);
  useEffect(() => {
    if (!o.peeking || !o.active) return;
    const b = slide.addListener(({ value }) => {
      values.current.slide = value;
      apply.current();
    });
    return () => slide.removeListener(b);
  }, [slide, o.peeking, o.active]);
  useEffect(() => void (o.active && apply.current()), [o.width, o.peeking, o.fullscreen, o.lights, o.active]);
}
