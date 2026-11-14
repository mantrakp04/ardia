import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomLift } from "../search/useKeyboardHeight";
import { useToast } from "../../state/toasts/hooks";
import { tapToast, type ToastIcon } from "../../state/toasts/store";
import { barHeight, capsule, font, space, Symbol, tabsMotion, toastLayout, useTheme, type SymbolName } from "../ui";

const ICONS: Record<ToastIcon, SymbolName> = {
  checkmark: "checkmark",
  warning: "exclamationmarkTriangle",
  download: "arrowDownCircle",
  blocking: "handRaised",
  link: "link",
  laptop: "laptop",
  star: "starFill",
  sent: "paperplane",
};

export function ToastHost() {
  const toast = useToast();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { lift, keyboard } = useBottomLift();
  if (!toast) return null;
  const bottom = keyboard ? lift + space.xs : barHeight(insets.bottom) + space.m;
  return (
    <View style={[styles.host, { bottom }]} pointerEvents="box-none">
      <Animated.View key={toast.id} entering={FadeIn.duration(tabsMotion.surfaceFade)} exiting={FadeOut.duration(tabsMotion.surfaceFade)}>
        <Pressable
          accessibilityRole={toast.onTap ? "button" : "alert"}
          accessibilityLiveRegion="polite"
          onPress={tapToast}
          style={[
            styles.toast,
            { backgroundColor: theme.toastFill, borderColor: theme.panelBorder, shadowColor: theme.toastShadow, borderRadius: capsule(toastLayout.minHeight) },
          ]}
        >
          <Symbol name={ICONS[toast.icon]} size={toastLayout.iconSize} color={theme.label} />
          <Text style={[font.subheadline, styles.text, { color: theme.label }]} numberOfLines={3}>
            {toast.message}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute", left: toastLayout.sideInset, right: toastLayout.sideInset, alignItems: "center" },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    minHeight: toastLayout.minHeight,
    paddingHorizontal: space.l,
    paddingVertical: toastLayout.verticalPadding,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 1,
    shadowRadius: toastLayout.shadowRadius,
    shadowOffset: { width: 0, height: toastLayout.shadowY },
    elevation: 8,
  },
  text: { fontWeight: "600", flexShrink: 1 },
});
