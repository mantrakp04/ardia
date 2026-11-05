import { onWindowEvent, watchSidebarEdge } from "../../state/windows/nativeWindow";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { switchOn } from "../../state/app/switches";
import { layout, useTheme } from "../ui/theme";
import { spring, curve } from "../ui/motion";
import { Panel, reduceMotion, WindowDragRegion } from "../ui";
import { useSidebarSide, useWindowId } from "../../state/browser/hooks";
import { useSidebarDockState } from "../../state/windows/hooks";
import { useToolbarLightsCenter } from "../../state/windows/layout";
import { Sidebar } from "../sidebar/Sidebar";
import { dismissHoverIn } from "../../state/sidebar/hover";
import { useSidebarUi } from "../../state/sidebar/sidebarUi";
import { peekHeld, watchHolds } from "../../state/app/transientUi";
import { ProfileSwipe } from "./ProfileSwipe";
import { ARC_HIDE_MS, DOCK_SPRING, PEEK_RADIUS, SHADOWS } from "./tokens";
import {
  PEEK_BOTTOM,
  PEEK_ORIGIN,
  PEEK_EDGE_STRIP,
  dockMove,
  dockState,
  dockedCardInset,
  edgeWatchWidth,
  fromSidebarEdgeInStrip,
  inPeekHold,
  peekHoldWidth,
  peekSpan,
  shownAs,
  watchesEdge,
} from "./dockMotion";
import {
  ARC_LIGHTS_CENTER,
  devPeeks,
  peekShown,
  setDockMoving,
  setPeekShown,
  useDockMotion,
} from "../../state/windows/dockMotion";
import { useTabDrag } from "../../state/drag/tabDrag";
import { usePeek } from "./usePeek";
import { useSidebarLights, useTopStripLights } from "./useDockLights";

const SPRING = spring(DOCK_SPRING);

function useSidebarDock(open: boolean, animate: boolean, arc: boolean): { dock: Animated.Value; away: boolean } {
  const windowId = useWindowId();
  const dock = useRef(new Animated.Value(open ? 1 : 0)).current;
  const was = useRef(open);
  const [away, setAway] = useState(!open);
  useEffect(() => {
    if (was.current === open) return;
    was.current = open;
    const move = dockMove({ open, animated: animate && !reduceMotion() && switchOn("sidebarSlide"), arc, peekOut: peekShown(windowId) });
    if (move === "jump") {
      dock.stopAnimation();
      dock.setValue(open ? 1 : 0);
      setDockMoving(windowId, false);
      setAway(!open);
      return;
    }
    if (open) setAway(false);
    setDockMoving(windowId, true);
    (move === "arcHide"
      ? Animated.timing(dock, { toValue: 0, duration: ARC_HIDE_MS, easing: curve.enter, useNativeDriver: false })
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

type Inset = { top: number; right: number; bottom: number; left: number };

export function DockedLayout({
  fullscreen,
  topTabs,
  inset,
  windowWidth,
  topStrip,
  children,
}: {
  fullscreen: boolean;
  topTabs: boolean;
  inset: Inset;
  windowWidth: number;
  topStrip?: { strip: ReactNode; peek: ReactNode };
  children: ReactNode;
}) {
  const windowId = useWindowId();
  const [open, sidebarWidth, addressBar] = useSidebarDockState(windowId);
  const right = useSidebarSide(windowId) === "right";
  const width = useSidebarUi((u) => u.dragWidth[windowId]) ?? sidebarWidth;
  const arc = addressBar && !topTabs && switchOn("sidebarSlide");
  const toolbarLights = useToolbarLightsCenter();
  const lights = addressBar && !topTabs ? ARC_LIGHTS_CENTER : toolbarLights;
  const { dock, away } = useSidebarDock(open, !fullscreen, arc);
  const sideInset = right ? inset.right : inset.left;
  const edge = useMemo(
    () =>
      dock.interpolate({
        inputRange: [0, 1],
        outputRange: [sideInset, dockedCardInset(width)],
      }),
    [dock, width, sideInset],
  );
  const top = useMemo(() => dock.interpolate({ inputRange: [0, 1], outputRange: [layout.cardInset, inset.top] }), [dock, inset.top]);
  const stripY = useMemo(() => dock.interpolate({ inputRange: [0, 1], outputRange: [-inset.top, 0] }), [dock, inset.top]);
  const stripShown = topTabs && (open || !away);
  const moving = useDockMotion((m) => !!m.moving[windowId]);
  useTopStripLights(windowId, dock, topTabs && !fullscreen, inset.top, open);
  return (
    <>
      <Animated.View
        style={
          fullscreen
            ? { flex: 1 }
            : {
                flex: 1,
                flexDirection: "row",
                paddingTop: topTabs ? top : inset.top,
                paddingRight: !topTabs && right ? edge : inset.right,
                paddingBottom: inset.bottom,
                paddingLeft: !topTabs && !right ? edge : inset.left,
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
      {!topTabs && (
        <SidebarDock
          dock={dock}
          open={open}
          width={width}
          fullscreen={fullscreen}
          arc={arc}
          lights={lights}
          right={right}
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
  right,
  windowWidth,
}: {
  dock: Animated.Value;
  open: boolean;
  width: number;
  fullscreen: boolean;
  arc: boolean;
  lights: readonly [number, number];
  right: boolean;
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
  const state = dockState({ open, fullscreen, moving, peekLive: peek.live });
  const holdWidth = peekHoldWidth(width);
  const holdHeight = useRef(Infinity);
  const inHold = (stripX: number, y: number) => inPeekHold(fromSidebarEdgeInStrip(stripX, right), y, holdWidth, holdHeight.current);
  const peeking = state === "peeking";
  const shown = shownAs(state);
  useLayoutEffect(() => () => dismissHoverIn(windowId), [windowId, shown]);
  const watching = watchesEdge(state, moving);
  const draggingTab = useTabDrag((d) => d.phase === "tab" && d.windowId === windowId);
  const nativeHold = edgeWatchWidth(peeking, draggingTab, holdWidth);
  useEffect(() => {
    if (!watching) return;
    const sub = onWindowEvent((e) => {
      if (e.type !== "sidebarEdge" || e.id !== windowId) return;
      edgeOver.current = e.over;
      if (e.over) latestPeek.current.show();
      else latestPeek.current.hide();
    });
    watchSidebarEdge(windowId, true, nativeHold, right);
    return () => {
      sub.remove();
      watchSidebarEdge(windowId, false);
      edgeOver.current = false;
    };
  }, [windowId, watching, nativeHold, right]);
  useEffect(() => setPeekShown(windowId, peek.live, peekSpan(width, right, windowWidth)), [windowId, peek.live, width, right, windowWidth]);
  if (__DEV__) devPeeks[windowId] = peek;
  useEffect(() => () => setPeekShown(windowId, false), [windowId]);
  const panel = useRef(false);
  if (peeking) panel.current = true;
  const away = state === "fullscreen" || state === "away";
  const outward = right ? -1 : 1;
  const slideOut = useMemo(() => dock.interpolate({ inputRange: [0, 1], outputRange: [-width * outward, 0] }), [dock, width, outward]);
  const peekIn = useMemo(
    () => peek.slide.interpolate({ inputRange: [0, 1], outputRange: [-12 * outward, width * outward] }),
    [peek.slide, width, outward],
  );
  useSidebarLights(windowId, dock, peek.slide, { width, peeking, fullscreen, lights, right });
  const edgeSide = right ? "right" : "left";
  const sidebar = useMemo(
    () => (
      <ProfileSwipe>
        <Sidebar width={width} />
      </ProfileSwipe>
    ),
    [width],
  );

  const leaveStrip = (e: { nativeEvent: { clientX: number; clientY: number } }) => {
    if (!peek.live) peek.cancelPending(edgeOver.current);
    else if (!inHold(e.nativeEvent.clientX, e.nativeEvent.clientY)) peek.hide();
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
          style={{ position: "absolute", [edgeSide]: 0, top: 0, bottom: 0, width: holdWidth }}
        />
      )}
      {strip.current && (
        <View
          pointerEvents={!open && !fullscreen ? "auto" : "none"}
          onMouseEnter={peek.show}
          onMouseLeave={leaveStrip}
          style={{
            position: "absolute",
            [edgeSide]: 0,
            top: 0,
            bottom: layout.cardInset,
            width: !open && !fullscreen ? PEEK_EDGE_STRIP : 0,
          }}
        />
      )}
      <Animated.View
        pointerEvents={fullscreen || moving || (!open && !peeking) ? "none" : "auto"}
        style={{
          position: "absolute",
          ...(away ? { left: -10_000 } : { [edgeSide]: peeking ? PEEK_ORIGIN[0] : 0 }),
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
            <Panel fill={theme.windowTint[0]} radius={PEEK_RADIUS} shadow={SHADOWS.sidebarPeek} style={StyleSheet.absoluteFill} />
          </Animated.View>
        )}
        <Animated.View style={[{ flex: 1 }, peekStyle, peeking ? { borderRadius: PEEK_RADIUS, overflow: "hidden" } : null]}>
          {sidebar}
        </Animated.View>
      </Animated.View>
    </>
  );
}
