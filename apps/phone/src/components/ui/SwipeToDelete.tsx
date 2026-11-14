import { useMemo, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { rowDeletes, rowOffset } from "../../lib/sheetDrag";
import { tabsMotion } from "./motion";
import { Symbol } from "./Symbol";
import { useTheme } from "./theme";
import { ink, space } from "./tokens";

const SWIPE_SLOP = 12;

export function SwipeToDelete({ onDelete, children }: { onDelete: () => void; children: ReactNode }) {
  const theme = useTheme();
  const x = useSharedValue(0);
  const width = useSharedValue(0);
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-SWIPE_SLOP, SWIPE_SLOP])
        .failOffsetY([-SWIPE_SLOP, SWIPE_SLOP])
        .onUpdate((event) => {
          x.value = rowOffset(event.translationX);
        })
        .onEnd((event) => {
          if (rowDeletes(event.translationX, event.velocityX)) {
            x.value = withTiming(-width.value, { duration: tabsMotion.flyAway }, (finished) => {
              if (finished) runOnJS(onDelete)();
            });
          } else x.value = withSpring(0, tabsMotion.settle);
        }),
    [onDelete],
  );
  const row = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const under = useAnimatedStyle(() => ({ opacity: x.value < 0 ? 1 : 0 }));
  return (
    <GestureDetector gesture={swipe}>
      <View
        onLayout={(event) => {
          width.value = event.nativeEvent.layout.width;
        }}
      >
        <Animated.View style={[StyleSheet.absoluteFill, styles.under, { backgroundColor: theme.destructive }, under]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Symbol name="trash" size={20} color={ink.white} />
        </Animated.View>
        <Animated.View style={row}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  under: { alignItems: "flex-end", justifyContent: "center", paddingHorizontal: space.xl },
});
