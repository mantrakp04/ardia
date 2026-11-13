import type { ReactNode } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Backdrop } from "./Backdrop";
import { tabsMotion } from "./motion";
import { useTheme } from "./theme";
import { menuLayout } from "./tokens";

const rise = SlideInDown.springify().stiffness(tabsMotion.sheetIn.stiffness).damping(tabsMotion.sheetIn.damping);
const fall = SlideOutDown.springify().stiffness(tabsMotion.sheetOut.stiffness).damping(tabsMotion.sheetOut.damping);

export function Sheet({ onDismiss, children }: { onDismiss: () => void; children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View entering={FadeIn.duration(tabsMotion.surfaceFade)} exiting={FadeOut.duration(tabsMotion.surfaceFade)} style={StyleSheet.absoluteFill}>
        <Pressable accessibilityLabel="Close" style={[StyleSheet.absoluteFill, { backgroundColor: theme.trayDim }]} onPress={onDismiss} />
      </Animated.View>
      <Animated.View
        entering={rise}
        exiting={fall}
        style={[styles.sheet, { maxHeight: height - insets.top - menuLayout.sheetTopGap, paddingBottom: insets.bottom, shadowColor: theme.trayShadow }]}
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
