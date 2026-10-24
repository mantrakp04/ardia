import { hapticTick, onAppEvent, setDragEscapeCapture, Surface, Symbol } from "@ardia/shell";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, PanResponder, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { hex, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import { suppressHover } from "../sidebar/hover";
import { useSidebarWidth, withAlpha } from "../sidebar/tokens";
import {
  beginSidebarMove,
  canMoveSidebar,
  endSidebarMove,
  setMoveArea,
  sidebarGlyph,
  slabRect,
  updateSidebarMove,
  useSidebarMove,
  startsMoveDrag,
  type MoveArea,
  type PressRect,
  type SidebarSide,
} from "./sidebarMove";

const GRAB_PLATE = 30;
const SLAB_FADE_MS = 110;
const SLAB_SPRING = { stiffness: 987, damping: 56.5, mass: 1, useNativeDriver: false } as const;

export function SidebarMoveHandle({ windowId, style, children }: { windowId: string; style?: ViewStyle; children: ReactNode }) {
  const view = useRef<View>(null);
  const active = useRef(false);
  const pressedAt = useRef<[number, number]>([0, 0]);
  const bounds = useRef<PressRect | null>(null);
  const [lifted, setLifted] = useState(false);
  const grabFrom = (b: PressRect) =>
    useSidebarMove.setState({ grab: [b.x + b.width / 2 - pressedAt.current[0], b.y + b.height / 2 - pressedAt.current[1]] });
  const finish = useRef((commit: boolean) => {
    if (!active.current) return;
    active.current = false;
    setDragEscapeCapture(false);
    suppressHover(false);
    setLifted(false);
    endSidebarMove(commit);
  });
  useEffect(() => {
    const sub = onAppEvent((e) => e.type === "dragEscape" && finish.current(false));
    return () => {
      sub.remove();
      finish.current(false);
    };
  }, []);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: (e) => {
          pressedAt.current = [e.nativeEvent.pageX, e.nativeEvent.pageY];
          bounds.current = null;
          view.current?.measureInWindow((x, y, width, height) => {
            if (!width) return;
            bounds.current = { x, y, width, height };
            if (active.current) grabFrom(bounds.current);
          });
          return false;
        },
        onMoveShouldSetPanResponder: (_, g) =>
          startsMoveDrag(g, bounds.current) && canMoveSidebar(useBrowser.getState(), windowId),
        onPanResponderGrant: (_, g) => {
          if (!beginSidebarMove(windowId, g.moveX, g.moveY)) return;
          active.current = true;
          setLifted(true);
          suppressHover(true);
          setDragEscapeCapture(true);
          if (bounds.current) grabFrom(bounds.current);
        },
        onPanResponderMove: (_, g) => {
          if (active.current && updateSidebarMove(g.moveX, g.moveY) && useBrowser.getState().settings.tabReorderHaptics) hapticTick();
        },
        onPanResponderRelease: () => finish.current(true),
        onPanResponderTerminate: () => finish.current(false),
        onPanResponderTerminationRequest: () => false,
      }),
    [windowId],
  );
  return (
    <View ref={view} style={[style, lifted && { opacity: 0.35 }]} mouseDownCanMoveWindow={false} {...responder.panHandlers}>
      {children}
    </View>
  );
}

export function SidebarMovePreview() {
  const windowId = useWindowId();
  const moving = useSidebarMove((m) => m.windowId === windowId);
  const from = useSidebarMove((m) => m.from);
  const [shownFor, setShownFor] = useState<SidebarSide | null>(null);
  useEffect(() => {
    if (moving) setShownFor(from);
  }, [moving, from]);
  return moving || shownFor ? <MovePreview windowId={windowId} moving={moving} shownFor={shownFor} onHidden={() => setShownFor(null)} /> : null;
}

function MovePreview({ windowId, moving, shownFor, onHidden }: { windowId: string; moving: boolean; shownFor: SidebarSide | null; onHidden(): void }) {
  const [area, setArea] = useState<MoveArea>({ width: 0, height: 0 });
  const target = useSidebarMove((m) => m.target);
  useEffect(() => () => setMoveArea(windowId, null), [windowId]);
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) => {
        const next = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
        setArea(next);
        setMoveArea(windowId, next);
      }}
    >
      {shownFor && area.width > 0 && (
        <Slab windowId={windowId} area={area} side={moving ? target : null} from={shownFor} onHidden={onHidden} />
      )}
      {moving && <GrabbedGlyph />}
    </View>
  );
}

function Slab({ windowId, area, side, from, onHidden }: { windowId: string; area: MoveArea; side: SidebarSide | null; from: SidebarSide; onHidden(): void }) {
  const sidebarWidth = useSidebarWidth(windowId);
  const last = useRef(side ?? from);
  if (side) last.current = side;
  const placed = last.current;
  const rect = slabRect(placed, area, sidebarWidth);
  const x = useRef(new Animated.Value(rect.x)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const shown = side !== null;
  const active = placed !== from;
  useEffect(() => {
    Animated.spring(x, { toValue: rect.x, ...SLAB_SPRING }).start();
  }, [rect.x]);
  useEffect(() => {
    Animated.timing(fade, { toValue: shown ? 1 : 0, duration: SLAB_FADE_MS, easing: shown ? Easing.out(Easing.cubic) : Easing.in(Easing.quad), useNativeDriver: false }).start(
      ({ finished }) => finished && !shown && onHidden(),
    );
  }, [shown]);
  return (
    <SlabSurface
      style={{ position: "absolute", left: x, top: rect.y, width: rect.width, height: rect.height, opacity: fade }}
      active={active}
      icon={sidebarGlyph(placed === "right")}
      label={active ? `Move sidebar ${placed}` : `Sidebar stays ${placed}`}
    />
  );
}

function SlabSurface({ style, active, icon, label }: { style: Animated.WithAnimatedValue<ViewStyle>; active: boolean; icon: string; label: string }) {
  const theme = useTheme();
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(glow, { toValue: active ? 1 : 0, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [active]);
  const dark = theme.dark;
  const ink = active ? theme.accent : dark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.55)";
  return (
    <Animated.View
      style={[
        style,
        {
          borderRadius: 20,
          borderWidth: 0.5,
          borderColor: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
          backgroundColor: glow.interpolate({ inputRange: [0, 1], outputRange: [dark ? "rgba(255,236,214,0.04)" : "rgba(255,255,255,0.45)", withAlpha(theme.accent, dark ? 0.16 : 0.12)] }),
          alignItems: "center",
          justifyContent: "center",
        },
      ]}
    >
      <View
        style={{
          position: "absolute",
          left: 9.5,
          right: 9.5,
          top: 9.5,
          bottom: 9.5,
          borderRadius: 11,
          borderStyle: "dashed",
          borderWidth: active ? 2.33 : 2,
          borderColor: active ? theme.accent : dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
        }}
      />
      <Symbol name={icon} size={18} color={ink} style={{ width: 24, height: 20 }} />
      <Text style={{ marginTop: 11, fontSize: 13, fontWeight: "600", color: ink }}>{label}</Text>
    </Animated.View>
  );
}

function GrabbedGlyph() {
  const theme = useTheme();
  const x = useSidebarMove((m) => m.x + m.grab[0]);
  const y = useSidebarMove((m) => m.y + m.grab[1]);
  const right = useSidebarMove((m) => m.target === "right");
  return (
    <Surface
      fill={hex(theme.dark ? "rgba(44,42,43,0.92)" : "rgba(255,255,255,0.94)")}
      cornerRadius={7}
      borderColor={hex(theme.dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.1)")}
      borderWidth={0.5}
      shadowColor="#000000"
      shadowOpacity={theme.dark ? 0.4 : 0.16}
      shadowRadius={10}
      shadowOffset={[0, 4]}
      style={{ position: "absolute", left: x - GRAB_PLATE / 2, top: y - GRAB_PLATE / 2, width: GRAB_PLATE, height: GRAB_PLATE, alignItems: "center", justifyContent: "center" }}
    >
      <Symbol name={sidebarGlyph(right)} size={13} color={theme.icon} style={{ width: GRAB_PLATE, height: GRAB_PLATE }} />
    </Surface>
  );
}
