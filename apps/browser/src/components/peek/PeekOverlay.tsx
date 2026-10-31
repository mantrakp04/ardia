import { breadcrumb } from "@ardia/core";
import { WindowBackdrop, ink, MagnifyArea, reduceMotion, reduceMotionKnown, Surface, type MagnifyUpdate } from "../ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { hex, layout, useTheme } from "../ui/theme";
import { usePeekSplitFull, usePeeks } from "../../state/peek/hooks";
import { useTab } from "../../state/browser/hooks";
import type { Peek } from "../../state/peek/peek";
import { PEEK_MOTION, PEEK_SCRIM } from "./tokens";
import { PageLabel, SMALL_INSET, SMALL_WINDOW_FRAME, SMALL_WINDOW_RADIUS, SmallBar } from "../littleArdia/SmallChrome";
import { dismissPeek, finishPeek, openPeekAsTab, openPeekInSplit, registerPeekMotion } from "../../state/peek/actions";
import { pinchFollow, pinchOutcome } from "./pinch";

const INSET_FRACTION = 0.055;
const MIN_INSET = 16;
const START_SCALE = 0.12;
const GROW = PEEK_MOTION.grow;


export function peekFrame(width: number, height: number) {
  const x = Math.max(MIN_INSET, Math.round(width * INSET_FRACTION));
  const y = Math.max(MIN_INSET, Math.round(height * INSET_FRACTION));
  return { left: x, top: y, width: Math.max(0, width - 2 * x), height: Math.max(0, height - 2 * y) };
}

export function PeekOverlay({
  windowId,
  width,
  height,
  origin,
  fullscreen,
  page,
}: {
  windowId: string;
  width: number;
  height: number;
  origin: { x: number; y: number } | null;
  fullscreen: boolean;
  page: (tabId: string, sourceId: string, width: number) => ReactNode;
}) {
  const peek = usePeeks((p) => p[windowId]);
  if (!peek || width <= 0 || height <= 0) return null;
  return <PeekCard key={peek.tabId} windowId={windowId} peek={peek} width={width} height={height} origin={origin} fullscreen={fullscreen} page={page} />;
}

function PeekCard({
  windowId,
  peek,
  width,
  height,
  origin,
  fullscreen,
  page,
}: {
  windowId: string;
  peek: Peek;
  width: number;
  height: number;
  origin: { x: number; y: number } | null;
  fullscreen: boolean;
  page: (tabId: string, sourceId: string, width: number) => ReactNode;
}) {
  const theme = useTheme();
  const windowFrame = theme.dark ? SMALL_WINDOW_FRAME.dark : SMALL_WINDOW_FRAME.light;
  const frame = peekFrame(width, height);
  const [motion, setMotion] = useState<"fade" | "grow" | null>(() => {
    const reduce = reduceMotion();
    return reduce === null ? null : reduce ? "fade" : "grow";
  });
  const fade = motion === "fade";
  const [progress] = useState(() => new Animated.Value(0));
  const [expand] = useState(() => new Animated.Value(0));
  const leaving = useRef<"close" | "expand" | null>(null);
  const pinch = useRef<(update: MagnifyUpdate) => void>(() => {});

  const centerX = frame.left + frame.width / 2;
  const centerY = frame.top + frame.height / 2;
  const fromX = peek.from && origin ? Math.min(Math.max(peek.from.x - origin.x, 0), width) : centerX;
  const fromY = peek.from && origin ? Math.min(Math.max(peek.from.y - origin.y, 0), height) : centerY;

  useEffect(() => {
    if (motion) return;
    let live = true;
    void reduceMotionKnown.then((reduce) => live && setMotion(reduce ? "fade" : "grow"));
    return () => void (live = false);
  }, []);

  useEffect(() => {
    if (!motion) return;
    const grow = fade
      ? Animated.timing(progress, { toValue: 1, ...PEEK_MOTION.fadeIn, useNativeDriver: true })
      : Animated.spring(progress, { toValue: 1, ...GROW, overshootClamping: true, restDisplacementThreshold: 0.001, restSpeedThreshold: 0.01, useNativeDriver: true });
    grow.start();
    const close = () => {
      if (leaving.current) return;
      leaving.current = "close";
      progress.stopAnimation();
      Animated.timing(progress, { toValue: 0, ...PEEK_MOTION.close, useNativeDriver: true }).start(({ finished }) => {
        if (finished) finishPeek(windowId, peek.tabId);
      });
    };
    const grown = (done: () => void) => {
      if (leaving.current === "expand") return;
      leaving.current = "expand";
      progress.stopAnimation();
      progress.setValue(1);
      if (fade) return done();
      Animated.timing(expand, { toValue: 1, ...PEEK_MOTION.expand, useNativeDriver: true }).start(done);
    };
    pinch.current = ({ phase, magnification }) => {
      if (leaving.current) return;
      if (phase === "began" && !fade) {
        progress.stopAnimation();
        expand.stopAnimation();
      }
      if (phase === "ended" || phase === "cancelled") {
        const outcome = phase === "ended" ? pinchOutcome(magnification) : "stay";
        if (outcome === "close") return dismissPeek(windowId);
        if (outcome === "open") return openPeekAsTab(windowId);
        if (fade) return;
        const back = { ...GROW, overshootClamping: true, restDisplacementThreshold: 0.001, restSpeedThreshold: 0.01, useNativeDriver: true };
        Animated.parallel([Animated.spring(progress, { toValue: 1, ...back }), Animated.spring(expand, { toValue: 0, ...back })]).start();
        return;
      }
      if (fade) return;
      const follow = pinchFollow(magnification, START_SCALE);
      progress.setValue(follow.progress);
      expand.setValue(follow.expand);
    };
    return registerPeekMotion(windowId, close, grown);
  }, [motion]);

  const scaleX = fade
    ? 1
    : Animated.multiply(
        progress.interpolate({ inputRange: [0, 1], outputRange: [START_SCALE, 1] }),
        expand.interpolate({ inputRange: [0, 1], outputRange: [1, width / Math.max(frame.width, 1)] }),
      );
  const scaleY = fade
    ? 1
    : Animated.multiply(
        progress.interpolate({ inputRange: [0, 1], outputRange: [START_SCALE, 1] }),
        expand.interpolate({ inputRange: [0, 1], outputRange: [1, height / Math.max(frame.height, 1)] }),
      );
  const translateX = fade ? 0 : progress.interpolate({ inputRange: [0, 1], outputRange: [fromX - centerX, 0] });
  const translateY = fade ? 0 : progress.interpolate({ inputRange: [0, 1], outputRange: [fromY - centerY, 0] });
  const cardOpacity = fade ? progress : progress.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 1] });
  const dim = Animated.multiply(progress, expand.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={motion ? "box-none" : "none"}>
      <Animated.View pointerEvents={fullscreen ? "none" : "auto"} style={[StyleSheet.absoluteFill, { opacity: fullscreen ? 0 : dim }]}>
        <Pressable
          accessibilityLabel="Close Peek"
          onPress={() => dismissPeek(windowId)}
          style={{ flex: 1, borderRadius: layout.cardRadius, backgroundColor: theme.dark ? PEEK_SCRIM.dark : PEEK_SCRIM.light }}
        />
      </Animated.View>
      <Animated.View
        style={
          fullscreen
            ? { position: "absolute", left: 0, top: 0, width, height }
            : { position: "absolute", ...frame, opacity: cardOpacity, transform: [{ translateX }, { translateY }, { scaleX }, { scaleY }] }
        }
      >
        {!fullscreen && (
          <Surface
            fill={hex(theme.panel)}
            cornerRadius={SMALL_WINDOW_RADIUS}
            shadowColor={ink.black}
            shadowOpacity={windowFrame.shadowOpacity}
            shadowRadius={windowFrame.shadowRadius}
            shadowOffset={windowFrame.shadowOffset}
            style={StyleSheet.absoluteFill}
          />
        )}
        <MagnifyArea enabled={!fullscreen && !!motion} onMagnify={(update) => pinch.current(update)} style={{ flex: 1 }}>
          <View style={{ flex: 1, borderRadius: fullscreen ? 0 : SMALL_WINDOW_RADIUS, overflow: "hidden" }}>
            {!fullscreen && <WindowBackdrop vibrancy {...theme.backdrop} colors={theme.windowTint} grainOpacity={theme.grain} style={StyleSheet.absoluteFill} />}
            {!fullscreen && <PeekBar windowId={windowId} tabId={peek.tabId} />}
            <View
              style={
                fullscreen
                  ? { flex: 1 }
                  : { flex: 1, marginLeft: SMALL_INSET, marginRight: SMALL_INSET, marginBottom: SMALL_INSET, borderRadius: layout.cardRadius, overflow: "hidden", backgroundColor: theme.card }
              }
            >
              {page(peek.tabId, peek.sourceId, fullscreen ? width : frame.width - 2 * SMALL_INSET)}
            </View>
          </View>
        </MagnifyArea>
        {!fullscreen && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: SMALL_WINDOW_RADIUS, borderWidth: StyleSheet.hairlineWidth, borderColor: windowFrame.innerRim }]} />}
        {!fullscreen && (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: -StyleSheet.hairlineWidth,
              top: -StyleSheet.hairlineWidth,
              right: -StyleSheet.hairlineWidth,
              bottom: -StyleSheet.hairlineWidth,
              borderRadius: SMALL_WINDOW_RADIUS + StyleSheet.hairlineWidth,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: windowFrame.outerRim,
            }}
          />
        )}
      </Animated.View>
    </View>
  );
}

function PeekBar({ windowId, tabId }: { windowId: string; tabId: string }) {
  const tab = useTab(tabId);
  const splitFull = usePeekSplitFull(windowId);
  if (!tab) return null;
  const host = tab.url ? breadcrumb(tab.url).host : "";
  return (
    <SmallBar
      fieldLeft={SMALL_INSET}
      field={<PageLabel tab={tab} label={host ? `Peek: ${host}` : "Peek"} />}
      buttons={[
        { icon: "rectangle.split.2x1", size: 14, disabled: splitFull, tooltip: "Open in Split View", onPress: () => openPeekInSplit(windowId) },
        { icon: "arrow.up.left.and.arrow.down.right", size: 13, tooltip: "Open as Tab (⌘O)", onPress: () => openPeekAsTab(windowId) },
        { icon: "xmark", size: 13, tooltip: "Close (Esc)", onPress: () => dismissPeek(windowId) },
      ]}
    />
  );
}
