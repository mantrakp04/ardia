import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, StyleSheet, View } from "react-native";
import { useTheme } from "../ui/theme";
import { updateSplit } from "../../state/splits/actions";
import { useDragFallbackPane } from "../../state/splits/hooks";
import type { SplitView } from "../../state/browser/types";
import { resize, type Divider, type Rect } from "../window/geometry";
import { capsule, OverPage, space, Symbol, Text, Toast, withAlpha } from "../ui";
import { hideToast, useToasts } from "../../state/app/toasts";
import { useWindowId } from "../../state/browser/hooks";
import { useCardFrame } from "../window/cardFrame";
import type { Size } from "../ui/useSettled";
import { overPeek } from "../../state/windows/dockMotion";
import { zoneHit, zoneRect, type ZoneStage } from "./splitDrop";
import { setDropTarget, setOnPage, setTargetResolver, useTabDrag } from "../../state/drag/tabDrag";
import { splitViewAvailable } from "../../state/splits/splits";
import { FOCUS_RING, SPLIT_MOTION, splitColors, TOAST_ACTION_MS, TOAST_MS, ZONE_ACCENT_ALPHA, ZONE_DASH_INSET, ZONE_SLIDE_MS, zoneDashRadius, zoneRadius } from "./tokens";

export function SplitDividers({ split, dividers, width, height }: { split: SplitView; dividers: Divider[]; width: number; height: number }) {
  return (
    <>
      {dividers.map((d) => (
        <DividerHandle key={d.kind === "root" ? `r${d.index}` : "s"} split={split} divider={d} width={width} height={height} />
      ))}
    </>
  );
}

export type WindowShape = Size & { radius: number };

type Corners = { topLeft: number; topRight: number; bottomLeft: number; bottomRight: number };

export const SplitFocusRing = memo(function SplitFocusRing({ rect, origin, windowShape }: { rect: Rect; origin: { x: number; y: number } | null; windowShape: WindowShape | null }) {
  const theme = useTheme();
  const { inset, radius, splitGap } = useCardFrame();
  const framed = inset > 0;
  const room = framed ? splitGap / 2 : 0;
  const width = framed ? Math.min(FOCUS_RING.width, room) : FOCUS_RING.width;
  const outset = Math.min(FOCUS_RING.width + FOCUS_RING.gap, room);
  const corners = framed ? uniformCorners(radius > 0 ? radius + outset : 0) : windowCorners(rect, origin, windowShape);
  const box = { x: rect.x - outset, y: rect.y - outset, width: rect.width + outset * 2, height: rect.height + outset * 2 };
  const color = theme.powerUpColor ?? theme.accent;
  const edge = (style: { left: number; top: number; width: number; height: number }) => <View style={{ position: "absolute", backgroundColor: color, ...style }} />;
  const corner = (r: number, left: number, top: number, dx: number, dy: number) =>
    r > 0 && (
      <View style={{ position: "absolute", left, top, width: r, height: r, overflow: "hidden" }}>
        <View style={{ position: "absolute", left: dx, top: dy, width: r * 2, height: r * 2, borderRadius: r, borderWidth: width, borderColor: color, overflow: "hidden" }} />
      </View>
    );
  const { topLeft, topRight, bottomLeft, bottomRight } = corners;
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {edge({ left: box.x + topLeft, top: box.y, width: box.width - topLeft - topRight, height: width })}
      {edge({ left: box.x + bottomLeft, top: bottom - width, width: box.width - bottomLeft - bottomRight, height: width })}
      {edge({ left: box.x, top: box.y + topLeft, width, height: box.height - topLeft - bottomLeft })}
      {edge({ left: right - width, top: box.y + topRight, width, height: box.height - topRight - bottomRight })}
      {corner(topLeft, box.x, box.y, 0, 0)}
      {corner(topRight, right - topRight, box.y, -topRight, 0)}
      {corner(bottomLeft, box.x, bottom - bottomLeft, 0, -bottomLeft)}
      {corner(bottomRight, right - bottomRight, bottom - bottomRight, -bottomRight, -bottomRight)}
    </View>
  );
});

const uniformCorners = (r: number): Corners => ({ topLeft: r, topRight: r, bottomLeft: r, bottomRight: r });

function windowCorners(rect: Rect, origin: { x: number; y: number } | null, windowShape: WindowShape | null): Corners {
  if (!origin || !windowShape || windowShape.radius <= 0) return uniformCorners(0);
  const r = windowShape.radius;
  const touches = (a: number, b: number) => Math.abs(a - b) < 0.5;
  const left = touches(origin.x + rect.x, 0);
  const top = touches(origin.y + rect.y, 0);
  const right = touches(origin.x + rect.x + rect.width, windowShape.width);
  const bottom = touches(origin.y + rect.y + rect.height, windowShape.height);
  return { topLeft: left && top ? r : 0, topRight: right && top ? r : 0, bottomLeft: left && bottom ? r : 0, bottomRight: right && bottom ? r : 0 };
}

const sizesOf = (split: SplitView) => ({ sizes: split.slots.map((slot) => slot.size), stack: split.slots.find((slot) => "stack" in slot)?.stackSizes });

function DividerHandle({ split, divider, width, height }: { split: SplitView; divider: Divider; width: number; height: number }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ sizes: number[]; stack?: [number, number] }>(sizesOf(split));
  const latest = useRef({ split, divider, width, height });
  latest.current = { split, divider, width, height };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          const { split: v } = latest.current;
          start.current = sizesOf(v);
          setDragging(true);
        },
        onPanResponderMove: (_, g) => {
          const { split: v, divider: d, width: w, height: h } = latest.current;
          const delta = d.vertical ? g.dx : g.dy;
          const gap = d.vertical ? d.rect.width : d.rect.height;
          if (d.kind === "root") {
            updateSplit(v.id, { sizes: resize(start.current.sizes, d.index, delta, d.vertical ? w : h, gap) });
          } else if (start.current.stack) {
            const next = resize(start.current.stack, 0, delta, d.vertical ? w : h, gap) as [number, number];
            updateSplit(v.id, { stackSizes: next });
          }
        },
        onPanResponderRelease: () => setDragging(false),
        onPanResponderTerminate: () => setDragging(false),
      }),
    [],
  );

  const { rect, vertical } = divider;
  const active = hovered || dragging;
  const cursor = vertical ? "col-resize" : "row-resize";
  return (
    <View
      {...responder.panHandlers}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "absolute",
        left: rect.x - (vertical ? 2 : 0),
        top: rect.y - (vertical ? 0 : 2),
        width: rect.width + (vertical ? 4 : 0),
        height: rect.height + (vertical ? 0 : 4),
        alignItems: "center",
        justifyContent: "center",
        cursor,
      }}
    >
      <View
        pointerEvents="none"
        style={{
          cursor,
          width: vertical ? HANDLE_THICKNESS : HANDLE_LENGTH,
          height: vertical ? HANDLE_LENGTH : HANDLE_THICKNESS,
          borderRadius: capsule(HANDLE_THICKNESS),
          backgroundColor: theme.mark,
          opacity: dragging ? 0.55 : active ? 0.32 : 0,
        }}
      />
    </View>
  );
}

const HANDLE_THICKNESS = 4;
const HANDLE_LENGTH = 36;

export function DropTargets({ panes, origin }: { panes: Record<string, Rect>; origin: { x: number; y: number } | null }) {
  const windowId = useWindowId();
  const dragging = useTabDrag((s) => (s.phase === "tab" && s.windowId === windowId ? s.tabId : null));
  const x = useTabDrag((s) => (s.phase === "tab" ? s.x : -1));
  const y = useTabDrag((s) => (s.phase === "tab" ? s.y : -1));
  const lifted = useTabDrag((s) => (s.phase === "tab" ? s.lifted : null));
  const outside = useTabDrag((s) => s.phase === "tab" && s.outside);
  const target = useTabDrag((s) => (s.phase === "tab" ? s.target : null));
  const full = Object.keys(panes).length >= 3;
  const fallback = useDragFallbackPane(dragging, panes, windowId);
  const candidates = useMemo((): [string, Rect][] => {
    if (fallback && dragging) return [[fallback, panes[dragging]!]];
    return Object.entries(panes).filter(([tabId]) => tabId !== dragging);
  }, [panes, dragging, fallback]);

  const px = origin ? x - origin.x : -1;
  const py = origin ? y - origin.y : -1;
  const overPage = !!origin && x >= 0 && !overPeek(windowId, x) && Object.values(panes).some((r) => px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height);
  const shown = !!dragging && !!origin && !full && !outside && candidates.length > 0 && (lifted ?? overPage);
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    setGrown(false);
    if (!shown) return;
    const timer = setTimeout(() => setGrown(true), ZONE_SLIDE_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  const hit = splitViewAvailable && shown && grown && overPage ? zoneHit(candidates, px, py, target) : null;
  const preview = shown && overPage;
  const resolver = useRef({ candidates, origin, panes, ready: false });
  resolver.current = { candidates, origin, panes, ready: !!dragging && !!origin && !full && candidates.length > 0 && grown && lifted !== false };
  useEffect(() => {
    if (!dragging) return;
    setTargetResolver((x, y, current, outside) => {
      const { candidates, origin, panes, ready } = resolver.current;
      if (!ready || outside || !origin || overPeek(windowId, x)) return null;
      const px = x - origin.x, py = y - origin.y;
      if (!Object.values(panes).some((r) => px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height)) return null;
      return zoneHit(candidates, px, py, current);
    });
    return () => setTargetResolver(null);
  }, [dragging]);
  useEffect(() => setDropTarget(hit), [hit?.tabId, hit?.side]);
  useEffect(() => setOnPage(preview), [preview]);
  useEffect(
    () => () => {
      setDropTarget(null);
      setOnPage(false);
    },
    [],
  );
  const [mounted, setMounted] = useState<[string, Rect][]>([]);
  useEffect(() => {
    if (shown && splitViewAvailable) setMounted(candidates);
  }, [shown, candidates]);

  if (!mounted.length) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {mounted.flatMap(([tabId, rect]) =>
        (["left", "right"] as const).map((side) => (
          <DropZone
            key={`${tabId}${side}`}
            pane={rect}
            side={side}
            shown={shown}
            stage={target?.tabId === tabId && target.side === side ? "active" : grown ? "grown" : "rest"}
            pointerX={px}
            onHidden={() => setMounted([])}
          />
        )),
      )}
    </View>
  );
}

const ZONE_SPRING = { ...SPLIT_MOTION.zoneSpring, useNativeDriver: false } as const;

function DropZone({ pane, side, shown, stage, pointerX, onHidden }: { pane: Rect; side: "left" | "right"; shown: boolean; stage: ZoneStage; pointerX: number; onHidden(): void }) {
  const theme = useTheme();
  const rect = zoneRect(pane, side, stage, pointerX);
  const [anim] = useState(() => ({ x: new Animated.Value(rect.x), y: new Animated.Value(rect.y), w: new Animated.Value(rect.width), h: new Animated.Value(rect.height) }));
  const glow = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(0)).current;
  const active = stage === "active";
  useEffect(() => {
    Animated.parallel([
      Animated.spring(anim.x, { toValue: rect.x, ...ZONE_SPRING }),
      Animated.spring(anim.y, { toValue: rect.y, ...ZONE_SPRING }),
      Animated.spring(anim.w, { toValue: rect.width, ...ZONE_SPRING }),
      Animated.spring(anim.h, { toValue: rect.height, ...ZONE_SPRING }),
    ]).start();
  }, [rect.x, rect.y, rect.width, rect.height]);
  useEffect(() => {
    Animated.timing(glow, { toValue: active ? 1 : 0, ...SPLIT_MOTION.zoneGlow, useNativeDriver: false }).start();
  }, [active]);
  useEffect(() => {
    Animated.timing(slide, { toValue: shown ? 1 : 0, ...(shown ? SPLIT_MOTION.zoneIn : SPLIT_MOTION.zoneOut), useNativeDriver: false }).start(
      ({ finished }) => finished && !shown && onHidden(),
    );
  }, [shown]);
  const away = side === "left" ? -(rect.x - pane.x + rect.width) : pane.x + pane.width - rect.x;
  const dark = theme.dark;
  const colors = splitColors(dark);
  const rest = colors.zoneRest;
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: anim.x,
        top: anim.y,
        width: anim.w,
        height: anim.h,
        borderRadius: zoneRadius(),
        borderWidth: 0.5,
        borderColor: colors.zoneBorder,
        backgroundColor: glow.interpolate({ inputRange: [0, 1], outputRange: [colors.zoneFill, withAlpha(theme.accent, dark ? ZONE_ACCENT_ALPHA.dark : ZONE_ACCENT_ALPHA.light)] }),
        alignItems: "center",
        justifyContent: "center",
        transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [away, 0] }) }],
      }}
    >
      <OverPage radius={zoneRadius()} />
      <View
        style={{
          position: "absolute",
          left: ZONE_DASH_INSET,
          right: ZONE_DASH_INSET,
          top: ZONE_DASH_INSET,
          bottom: ZONE_DASH_INSET,
          borderRadius: zoneDashRadius(),
          borderStyle: "dashed",
          borderWidth: active ? 2.33 : 2,
          borderColor: active ? theme.accent : colors.zoneDash,
        }}
      />
      <Symbol name={side === "left" ? "rectangle.lefthalf.filled" : "rectangle.righthalf.filled"} size={18} color={active ? theme.accent : rest} style={{ width: 24, height: 20 }} />
      <Text weight="semibold" color={active ? theme.accent : rest} style={{ marginTop: space.l }}>{side === "left" ? "Add left split" : "Add right split"}</Text>
    </Animated.View>
  );
}

export const SplitToast = memo(function SplitToast({ windowId }: { windowId: string }) {
  const toast = useToasts((s) => s.toasts[windowId] ?? null);
  const [shown, setShown] = useState(toast);
  const [closing, setClosing] = useState(false);
  if (toast && toast !== shown) {
    setShown(toast);
    setClosing(false);
  } else if (!toast && shown && !closing) setClosing(true);
  useEffect(() => {
    if (!toast || toast.sticky) return;
    const timer = setTimeout(() => setClosing(true), toast.action ? TOAST_ACTION_MS : TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast?.id]);
  if (!shown) return null;
  const action = shown.action;
  return (
    <Toast
      key={shown.id}
      title={shown.title}
      message={shown.message ?? undefined}
      icon={shown.icon ?? "rectangle.split.3x1"}
      action={action?.title}
      onAction={() => {
        action?.run();
        setShown(null);
        hideToast(windowId, shown.id);
      }}
      closing={closing}
      onClosed={() => {
        setShown(null);
        setClosing(false);
        hideToast(windowId, shown.id);
      }}
    />
  );
});
