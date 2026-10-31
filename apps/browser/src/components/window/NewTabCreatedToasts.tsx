import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, StyleSheet, View } from "react-native";
import { Panel, radius, space, Text, useTheme } from "../ui";
import { useWindow } from "../../state/browser/hooks";
import { useTabEngine } from "../../state/windows/card";
import { NEW_TAB_TOAST_FADE, NEW_TAB_TOAST_GAP, NEW_TAB_TOAST_HEIGHT, visibleNewTabToasts, type NewTabToast } from "../../state/tabs/newTabToasts";
import { useNewTabToastItems, useNewTabToastsCovered } from "../../state/tabs/hooks";
import { activateNewTabToast, presentNewTabToast } from "../../state/tabs/actions";
import { usePages } from "../../state/tabs/pageState";
import { useMedia } from "../../state/media/media";
import { useCast } from "../../state/media/cast";
import { useDeviceChooserOpen } from "../../state/site/deviceChoosers";
import { newTabToastPrompt } from "./newTabToastProtection";
import { newTabToastRect } from "./newTabToastGeometry";
import { NEW_TAB_TOAST_INSET, NEW_TAB_TOAST_MOTION, SHADOWS, windowColors } from "./tokens";

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
  const profileId = useWindow(windowId, (w) => w?.profileId);
  const engine = useTabEngine(tabId);
  const covered = useNewTabToastsCovered(windowId, tabId);
  const prompt = usePages((s) => newTabToastPrompt(s.pages[tabId], s.popover[tabId]));
  const pageLayout = usePages((s) => s.pages[tabId]?.pageLayout);
  const sharing = useMedia((s) => !!s.displayRequests[tabId]);
  const casting = useCast((s) => !!s.dialogs[tabId]);
  const choosing = useDeviceChooserOpen(tabId);
  const items = useNewTabToastItems();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const reduced = useReducedMotion();
  const frame = newTabToastRect(pageLayout, size.width, size.height, nativePage, engine);
  const shown = visibleNewTabToasts(items, windowId, profileId, frame?.height ?? 0, covered || prompt || sharing || casting || choosing, frame?.width ?? 0);
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
      {frame && (
        <View pointerEvents="box-none" style={{ position: "absolute", left: frame.x, top: frame.y, width: frame.width, height: frame.height }}>
          <View pointerEvents="box-none" style={{ position: "absolute", ...NEW_TAB_TOAST_INSET, gap: NEW_TAB_TOAST_GAP, alignItems: "flex-end" }}>
            {shown.map((toast) => <ToastRow key={toast.tabId} toast={toast} reduced={reduced} />)}
          </View>
        </View>
      )}
    </View>
  );
}

function ToastRow({ toast, reduced }: { toast: NewTabToast; reduced: boolean | null }) {
  const colors = windowColors(useTheme().dark);
  const enter = useRef(new Animated.Value(toast.appearedAt === null ? 0 : 1)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const [laidOut, setLaidOut] = useState(false);
  const [interactive, setInteractive] = useState(toast.appearedAt !== null);
  useEffect(() => {
    if (!laidOut || reduced === null) return;
    presentNewTabToast(toast.tabId);
    const animation = reduced
      ? Animated.timing(enter, { toValue: 1, ...NEW_TAB_TOAST_MOTION.reducedEnter, useNativeDriver: true })
      : Animated.spring(enter, { toValue: 1, ...NEW_TAB_TOAST_MOTION.enter, useNativeDriver: true });
    animation.start(({ finished }) => finished && setInteractive(true));
    return () => animation.stop();
  }, [toast.tabId, laidOut, reduced, enter]);
  useEffect(() => {
    if (!toast.leaving) return;
    const animation = Animated.timing(fade, { toValue: 0, duration: NEW_TAB_TOAST_FADE, ...NEW_TAB_TOAST_MOTION.leave, useNativeDriver: true });
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
      <Pressable accessibilityRole="button" accessibilityLabel="New Tab Created" accessibilityHint="Switch to this new tab" onPress={() => activateNewTabToast(toast)}>
        <Panel
          fill={colors.newTabToastFill}
          radius={radius.sheet}
          border={colors.newTabToastBorder}
          borderWidth={0.5}
          shadow={SHADOWS.newTabToast}
          style={{ height: NEW_TAB_TOAST_HEIGHT, paddingHorizontal: space.l, justifyContent: "center", alignItems: "center" }}
        >
          <Text size="body" weight="semibold" lines={1} style={{ textAlign: "center" }}>New Tab Created</Text>
        </Panel>
      </Pressable>
    </Animated.View>
  );
}
