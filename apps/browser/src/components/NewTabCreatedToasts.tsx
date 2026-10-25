import { Surface } from "@ardia/shell";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { hex, useTheme } from "../lib/theme";
import { useBrowser } from "../store/browser";
import { tabEngine } from "../store/engines";
import { NEW_TAB_TOAST_FADE, NEW_TAB_TOAST_GAP, NEW_TAB_TOAST_HEIGHT, NEW_TAB_TOAST_WIDTH, newTabToasts, visibleNewTabToasts, type NewTabToast } from "../store/newTabToasts";
import { usePages } from "./layout/pageState";
import { newTabToastPrompt } from "./layout/newTabToastProtection";
import { newTabToastRect } from "./layout/newTabToastGeometry";
import { useCast } from "./media/cast";
import { useMedia } from "./media/state";
import { useDeviceChooserOpen } from "./site/DeviceChooser";

function useReducedMotion() {
  const [reduced, setReduced] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    let changed = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => live && !changed && setReduced(on), () => live && !changed && setReduced(true));
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => {
      changed = true;
      if (live) setReduced(on);
    });
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

export function NewTabCreatedToasts({ windowId, tabId, nativePage }: { windowId: string; tabId: string; nativePage: boolean }) {
  const profileId = useBrowser((s) => s.windows[windowId]?.profileId);
  const engine = useBrowser((s) => tabEngine(s, tabId));
  const obscured = useBrowser((s) => !!s.peeks[windowId] || !!s.find[tabId]?.open || !!s.windowUi[windowId]?.panel.open);
  const prompt = usePages((s) => newTabToastPrompt(s.pages[tabId], s.popover[tabId]));
  const pageLayout = usePages((s) => s.pages[tabId]?.pageLayout);
  const sharing = useMedia((s) => !!s.displayRequests[tabId]);
  const casting = useCast((s) => !!s.dialogs[tabId]);
  const choosing = useDeviceChooserOpen(tabId);
  const items = newTabToasts.useStore((s) => s.items);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const reduced = useReducedMotion();
  const frame = newTabToastRect(pageLayout, size.width, size.height, nativePage, engine);
  const shown = visibleNewTabToasts(items, windowId, profileId, frame?.height ?? 0, obscured || prompt || sharing || casting || choosing, frame?.width ?? 0);
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
      {frame && (
        <View pointerEvents="box-none" style={{ position: "absolute", left: frame.x, top: frame.y, width: frame.width, height: frame.height }}>
          <View pointerEvents="box-none" style={{ position: "absolute", top: 10, right: 24, gap: NEW_TAB_TOAST_GAP }}>
            {shown.map((toast) => <ToastRow key={toast.tabId} toast={toast} reduced={reduced} />)}
          </View>
        </View>
      )}
    </View>
  );
}

function ToastRow({ toast, reduced }: { toast: NewTabToast; reduced: boolean | null }) {
  const theme = useTheme();
  const enter = useRef(new Animated.Value(toast.appearedAt === null ? 0 : 1)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const [laidOut, setLaidOut] = useState(false);
  const [interactive, setInteractive] = useState(toast.appearedAt !== null);
  useEffect(() => {
    if (!laidOut || reduced === null) return;
    newTabToasts.present(toast.tabId);
    const animation = reduced
      ? Animated.timing(enter, { toValue: 1, duration: 160, useNativeDriver: true })
      : Animated.spring(enter, { toValue: 1, speed: 22, bounciness: 5, useNativeDriver: true });
    animation.start(({ finished }) => finished && setInteractive(true));
    return () => animation.stop();
  }, [toast.tabId, laidOut, reduced, enter]);
  useEffect(() => {
    if (!toast.leaving) return;
    const animation = Animated.timing(fade, { toValue: 0, duration: NEW_TAB_TOAST_FADE, easing: Easing.in(Easing.quad), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [toast.leaving, fade]);
  return (
    <Animated.View
      pointerEvents={interactive && !toast.leaving ? "auto" : "none"}
      onLayout={() => setLaidOut(true)}
      style={{
        opacity: Animated.multiply(enter, fade),
        transform: reduced !== false ? undefined : [
          { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) },
          { scaleX: enter.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0.18, 0.65, 1] }) },
          { scaleY: enter.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0.65, 1.06, 1] }) },
        ],
      }}
    >
      <Pressable accessibilityRole="button" accessibilityLabel="New Tab Created" accessibilityHint="Switch to this new tab" onPress={() => newTabToasts.activate(toast.tabId, toast.windowId, toast.profileId, useBrowser.getState())}>
        <Surface
          fill={hex(theme.dark ? "rgba(44,42,43,0.96)" : "rgba(255,255,255,0.96)")}
          cornerRadius={14}
          borderColor={hex(theme.dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.1)")}
          borderWidth={0.5}
          shadowColor="#000000"
          shadowOpacity={theme.dark ? 0.35 : 0.14}
          shadowRadius={12}
          shadowOffset={[0, 4]}
          style={{ width: NEW_TAB_TOAST_WIDTH, height: NEW_TAB_TOAST_HEIGHT, paddingHorizontal: 16, justifyContent: "center" }}
        >
          <Text style={{ fontSize: 13, fontWeight: "600", color: theme.textPrimary }}>New Tab Created</Text>
        </Surface>
      </Pressable>
    </Animated.View>
  );
}
