import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomLift } from "../search/useKeyboardHeight";
import { useSurface } from "../../state/browse/hooks";
import { useDeckBarTop, useToast } from "../../state/toasts/hooks";
import { toastBottom } from "../../state/toasts/placement";
import { tapToast, type ToastIcon } from "../../state/toasts/store";
import { capsule, font, space, Symbol, tabsMotion, toastLayout, useTheme, type SymbolName } from "../ui";

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
  const insets = useSafeAreaInsets();
  const { lift, keyboard } = useBottomLift();
  const surface = useSurface();
  const barTop = useDeckBarTop();
  const frame = useRef<View>(null);
  const [hostBottom, setHostBottom] = useState(0);
  const bottom = toastBottom({
    keyboardLift: keyboard ? lift : null,
    safeBottom: insets.bottom,
    barClearance: toastLayout.barClearance,
    hostBottomY: hostBottom,
    barTopY: surface === "browsing" ? null : barTop,
    gap: space.s,
  });
  return (
    <View
      ref={frame}
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
      onLayout={() => frame.current?.measureInWindow((_x, y, _width, height) => setHostBottom(y + height))}
    >
      <ToastView bottom={bottom} />
    </View>
  );
}

function ToastView({ bottom }: { bottom: number }) {
  const toast = useToast();
  const theme = useTheme();
  if (!toast) return null;
  return (
    <View style={[styles.host, { bottom }]} pointerEvents="box-none">
      <Animated.View key={toast.id} entering={FadeIn.duration(tabsMotion.surfaceFade)} pointerEvents={toast.onTap ? "auto" : "none"}>
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
