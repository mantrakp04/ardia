import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { StyleSheet, useWindowDimensions, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { backgroundScale, draggedOffset, sheetDismisses, sheetProgress } from "../../lib/sheetDrag";
import { tabsCurve, tabsMotion } from "./motion";
import { useTheme } from "./theme";
import { sheetInk, sheetLayout } from "./tokens";

const HIDE_FALLBACK_MS = 900;
const DRAG_SLOP = 12;

type ListProps = {
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onLayout: (event: LayoutChangeEvent) => void;
  scrollEventThrottle: number;
};

type SheetFrame = { top: number; list: (refreshesOnPull: boolean) => ListProps };

const SheetFrameContext = createContext<SheetFrame | null>(null);

export const useSheetFrame = (): SheetFrame | null => useContext(SheetFrameContext);

type Props<T extends string> = { sheet: T | null; progress: SharedValue<number>; onDismiss: () => void; children: (shown: T) => ReactNode };

export function FullSheet<T extends string>({ sheet, progress, onDismiss, children }: Props<T>) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const top = insets.top + sheetLayout.topGap;
  const [shown, setShown] = useState<T | null>(sheet);
  const height = useSharedValue(Math.max(1, window.height - top));
  const offset = useSharedValue(sheet ? 0 : height.value);
  const dragFrom = useSharedValue(0);
  const scrollTop = useSharedValue(0);
  const touch = useSharedValue({ x: 0, y: 0, inList: false });
  const listTop = useSharedValue(0);
  const listPulls = useSharedValue(false);

  useEffect(() => {
    if (sheet) {
      if (!shown) offset.value = height.value;
      setShown(sheet);
      scrollTop.value = 0;
      offset.value = reduceMotion ? withTiming(0, { duration: tabsMotion.sheetReduced, easing: tabsCurve.easeOut }) : withSpring(0, tabsMotion.sheetRise);
      return;
    }
    if (!shown) return;
    const hide = () => setShown(null);
    offset.value = reduceMotion
      ? withTiming(height.value, { duration: tabsMotion.sheetReduced, easing: tabsCurve.easeInOut }, (finished) => {
          if (finished) runOnJS(hide)();
        })
      : withSpring(height.value, tabsMotion.sheetDismiss, (finished) => {
          if (finished) runOnJS(hide)();
        });
    const fallback = setTimeout(hide, HIDE_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [sheet]);

  useAnimatedReaction(
    () => sheetProgress(offset.value, height.value),
    (now) => {
      progress.value = now;
    },
  );

  const drag = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .onTouchesDown((event) => {
          const first = event.allTouches[0];
          if (first) touch.value = { x: first.absoluteX, y: first.absoluteY, inList: first.absoluteY - top - offset.value >= listTop.value };
        })
        .onTouchesMove((event, manager) => {
          const first = event.allTouches[0];
          if (!first) return;
          const dx = first.absoluteX - touch.value.x;
          const dy = first.absoluteY - touch.value.y;
          if (Math.abs(dx) > DRAG_SLOP && Math.abs(dx) > Math.abs(dy)) manager.fail();
          else if (dy < -DRAG_SLOP) manager.fail();
          else if (dy > DRAG_SLOP && dy > Math.abs(dx)) {
            if (!touch.value.inList || (scrollTop.value <= 0 && !listPulls.value)) manager.activate();
            else manager.fail();
          }
        })
        .onStart(() => {
          dragFrom.value = offset.value;
        })
        .onUpdate((event) => {
          offset.value = draggedOffset(dragFrom.value, event.translationY, height.value);
        })
        .onEnd((event) => {
          if (sheetDismisses(offset.value, height.value, event.velocityY)) runOnJS(onDismiss)();
          else offset.value = withSpring(0, tabsMotion.sheetRise);
        }),
    [onDismiss, top],
  );

  const frame = useMemo<SheetFrame>(
    () => ({
      top,
      list: (refreshesOnPull) => ({
        scrollEventThrottle: 16,
        onScroll: (event) => {
          scrollTop.value = event.nativeEvent.contentOffset.y;
        },
        onLayout: (event) => {
          listTop.value = event.nativeEvent.layout.y;
          listPulls.value = refreshesOnPull;
        },
      }),
    }),
    [top],
  );

  const scrim = useAnimatedStyle(() => ({ opacity: progress.value }));
  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));
  if (!shown) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={sheet ? "auto" : "none"}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrim]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      <GestureDetector gesture={drag}>
        <Animated.View
          accessibilityViewIsModal
          onLayout={(event) => {
            height.value = Math.max(1, event.nativeEvent.layout.height);
          }}
          style={[styles.sheet, { top }, slide]}
        >
          <SheetFrameContext.Provider value={frame}>{children(shown)}</SheetFrameContext.Provider>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

export function SheetBackground({ progress, children }: { progress: SharedValue<number>; children: ReactNode }) {
  const theme = useTheme();
  const shrink = useAnimatedStyle(() => ({
    transform: [{ scale: backgroundScale(progress.value) }],
    borderRadius: progress.value > 0 ? sheetLayout.backgroundRadius : 0,
  }));
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.surface }]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.clip, shrink]}>{children}</Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: sheetInk.scrim },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden",
    borderTopLeftRadius: sheetLayout.radius,
    borderTopRightRadius: sheetLayout.radius,
  },
  clip: { overflow: "hidden" },
});
