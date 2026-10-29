import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../ui/theme";
import { updateSplit } from "../../state/splits/actions";
import { useDragFallbackPane } from "../../state/splits/hooks";
import type { SplitView } from "../../state/browser/types";
import { resize, type Divider, type Rect } from "../window/geometry";
import { font, Panel, radius, space, Symbol, useHover, VisualEffect, weight, withAlpha } from "../ui";
import { hideToast, useToasts } from "../../state/app/toasts";
import { useWindowId } from "../../state/browser/hooks";
import { overPeek } from "../../state/windows/dockMotion";
import { zoneHit, zoneRect, type ZoneStage } from "./splitDrop";
import { setDropTarget, setOnPage, setTargetResolver, useTabDrag } from "../../state/drag/tabDrag";
import { SPLIT_MOTION, SPLIT_SHADOWS, splitColors, ZONE_ACCENT_ALPHA, ZONE_DASH_RADIUS, ZONE_RADIUS, ZONE_SLIDE_MS } from "./tokens";

export function SplitDividers({ split, dividers, width, height }: { split: SplitView; dividers: Divider[]; width: number; height: number }) {
  return (
    <>
      {dividers.map((d) => (
        <DividerHandle key={d.kind === "root" ? `r${d.index}` : "s"} split={split} divider={d} width={width} height={height} />
      ))}
    </>
  );
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
          if (d.kind === "root") {
            updateSplit(v.id, { sizes: resize(start.current.sizes, d.index, delta, d.vertical ? w : h) });
          } else if (start.current.stack) {
            const next = resize(start.current.stack, 0, delta, d.vertical ? w : h) as [number, number];
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
        cursor: vertical ? "col-resize" : "row-resize",
      }}
    >
      <View
        style={{
          width: vertical ? 4 : 36,
          height: vertical ? 36 : 4,
          borderRadius: 2,
          backgroundColor: theme.mark,
          opacity: dragging ? 0.55 : active ? 0.32 : 0,
        }}
      />
    </View>
  );
}

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

  const hit = shown && grown && overPage ? zoneHit(candidates, px, py, target) : null;
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
    if (shown) setMounted(candidates);
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
  const anim = useRef({ x: new Animated.Value(rect.x), y: new Animated.Value(rect.y), w: new Animated.Value(rect.width), h: new Animated.Value(rect.height) }).current;
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
        borderRadius: ZONE_RADIUS,
        borderWidth: 0.5,
        borderColor: colors.zoneBorder,
        backgroundColor: glow.interpolate({ inputRange: [0, 1], outputRange: [colors.zoneFill, withAlpha(theme.accent, dark ? ZONE_ACCENT_ALPHA.dark : ZONE_ACCENT_ALPHA.light)] }),
        alignItems: "center",
        justifyContent: "center",
        transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [away, 0] }) }],
      }}
    >
      <View
        style={{
          position: "absolute",
          left: 9.5,
          right: 9.5,
          top: 9.5,
          bottom: 9.5,
          borderRadius: ZONE_DASH_RADIUS,
          borderStyle: "dashed",
          borderWidth: active ? 2.33 : 2,
          borderColor: active ? theme.accent : colors.zoneDash,
        }}
      />
      <Symbol name={side === "left" ? "rectangle.lefthalf.filled" : "rectangle.righthalf.filled"} size={18} color={active ? theme.accent : rest} style={{ width: 24, height: 20 }} />
      <Text style={{ marginTop: 11, ...font.body, fontWeight: weight.semibold, color: active ? theme.accent : rest }}>{side === "left" ? "Add left split" : "Add right split"}</Text>
    </Animated.View>
  );
}

export const SplitToast = memo(function SplitToast({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const toast = useToasts((s) => s.toasts[windowId] ?? null);
  const appear = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(toast);
  useEffect(() => {
    if (toast) return setShown(toast);
    if (!shown) return;
    Animated.timing(appear, { toValue: 0, ...SPLIT_MOTION.toastOut, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setShown(null);
    });
  }, [toast]);
  useEffect(() => {
    if (!toast) return;
    setShown(toast);
    appear.setValue(0);
    Animated.spring(appear, { toValue: 1, useNativeDriver: true, ...SPLIT_MOTION.toastIn }).start();
    if (toast.sticky) return;
    const timer = setTimeout(() => {
      Animated.timing(appear, { toValue: 0, ...SPLIT_MOTION.toastOut, useNativeDriver: true }).start(({ finished }) => {
        if (!finished) return;
        setShown(null);
        hideToast(windowId, toast.id);
      });
    }, toast.action ? 4000 : 2600);
    return () => clearTimeout(timer);
  }, [toast?.id]);
  if (!shown) return null;
  const toastColors = splitColors(theme.dark);
  return (
    <View pointerEvents={shown.action ? "box-none" : "none"} style={{ position: "absolute", left: 0, right: 0, bottom: 22, alignItems: "center" }}>
      <Animated.View style={{ opacity: appear, transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }, { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }}>
        <Panel
          fill={toastColors.toastFill}
          radius={radius.sheet}
          border={toastColors.toastBorder}
          shadow={SPLIT_SHADOWS.toast}
          style={{ paddingHorizontal: space.xl, paddingVertical: space.ml, flexDirection: "row", alignItems: "center", gap: space.ml, maxWidth: 420 }}
        >
          <VisualEffect material="hudWindow" cornerRadius={radius.sheet} style={StyleSheet.absoluteFill} />
          <Symbol name={shown.icon ?? "rectangle.split.3x1"} size={15} color={theme.icon} style={{ width: 20, height: 20 }} />
          <View style={{ flexShrink: 1 }}>
            <Text style={{ ...font.body, fontWeight: weight.semibold, color: theme.textPrimary }}>{shown.title}</Text>
            {shown.message ? <Text style={{ ...font.small, color: theme.textSecondary, marginTop: 1 }}>{shown.message}</Text> : null}
          </View>
          {shown.action ? (
            <ToastAction
              title={shown.action.title}
              onPress={() => {
                shown.action!.run();
                setShown(null);
                hideToast(windowId, shown.id);
              }}
            />
          ) : null}
        </Panel>
      </Animated.View>
    </View>
  );
});

function ToastAction({ title, onPress }: { title: string; onPress(): void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable {...hoverProps} onPress={onPress}>
      {({ pressed }) => (
        <View style={{ height: 24, paddingHorizontal: space.ml, borderRadius: radius.button, justifyContent: "center", backgroundColor: pressed ? theme.toolbarPressed : hovered ? theme.toolbarHover : theme.urlPill }}>
          <Text style={{ ...font.small, fontWeight: weight.medium, color: theme.textPrimary }}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}
