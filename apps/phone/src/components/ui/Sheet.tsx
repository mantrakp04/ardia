import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Backdrop } from "./Backdrop";
import { tabsMotion } from "./motion";
import { useTheme } from "./theme";
import { menuLayout } from "./tokens";

const HIDE_FALLBACK_MS = 900;

export function usePresence(open: boolean): { mounted: boolean; hidden: () => void } {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  return { mounted: open || mounted, hidden: () => setMounted(false) };
}

type Props = { open: boolean; onDismiss: () => void; onHidden: () => void; children: ReactNode };

export function Sheet({ open, onDismiss, onHidden, children }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const shown = useSharedValue(0);
  const sheetHeight = useSharedValue(height);
  useEffect(() => {
    if (open) {
      shown.value = withSpring(1, tabsMotion.sheetIn);
      return;
    }
    shown.value = withSpring(0, tabsMotion.sheetOut, (finished) => {
      if (finished) runOnJS(onHidden)();
    });
    const fallback = setTimeout(onHidden, HIDE_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [open]);
  const dim = useAnimatedStyle(() => ({ opacity: Math.min(Math.max(shown.value, 0), 1) }));
  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - shown.value) * sheetHeight.value }] }));
  const [settled] = useState(() => Math.max(height - insets.top - menuLayout.sheetTopGap, 0));
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? "box-none" : "none"}>
      <Animated.View style={[StyleSheet.absoluteFill, dim]}>
        <Pressable accessibilityLabel="Close" style={[StyleSheet.absoluteFill, { backgroundColor: theme.trayDim }]} onPress={onDismiss} />
      </Animated.View>
      <Animated.View
        onLayout={(event) => {
          sheetHeight.value = event.nativeEvent.layout.height;
        }}
        style={[styles.sheet, { maxHeight: settled, paddingBottom: insets.bottom, shadowColor: theme.trayShadow }, slide]}
      >
        <Backdrop colors={theme.backdrop} />
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden",
    borderTopLeftRadius: menuLayout.sheetRadius,
    borderTopRightRadius: menuLayout.sheetRadius,
    elevation: 12,
  },
});
