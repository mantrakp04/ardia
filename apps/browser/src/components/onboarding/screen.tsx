import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { PROFILE_COLORS } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { tabLayoutOf } from "../../store/model";
import type { Settings } from "../../store/settings";
import { MockWindow, type PreviewId } from "./previews";
import { resolveDraft, useOnboarding } from "./state";

export function useScreen<K extends keyof Settings>(keys: readonly K[]) {
  const windowId = useOnboarding((s) => s.windowId);
  const draft = useOnboarding((s) => s.draft);
  const preset = useOnboarding((s) => s.preset);
  const settings = useBrowser((s) => s.settings);
  const tabLayout = useBrowser((s) => tabLayoutOf(s, windowId));
  const base = { ...settings, tabLayout };
  const values = resolveDraft(keys, draft, preset, base);
  return { values, base, mock: { ...base, ...values } as Settings };
}

export function useAccent() {
  const windowId = useOnboarding((s) => s.windowId);
  const color = useBrowser((s) => s.profiles[s.windows[windowId ?? ""]?.profileId ?? ""]?.color ?? "plum");
  return (PROFILE_COLORS[color] ?? PROFILE_COLORS.plum).swatch;
}

const MOCK_SIZE = { width: 420, height: 300 } as const;

export function MockPanel({ settings, focus, overlay }: { settings: Partial<Settings>; focus: PreviewId | null; overlay?: ReactNode }) {
  const accent = useAccent();
  const t = useRef(new Animated.Value(overlay ? 1 : 0)).current;
  const [shown, setShown] = useState(overlay);
  useEffect(() => {
    if (overlay) setShown(overlay);
    Animated.timing(t, { toValue: overlay ? 1 : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
      if (finished && !overlay) setShown(null);
    });
  }, [!!overlay]);
  return (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{ width: MOCK_SIZE.width, height: MOCK_SIZE.height, opacity: t.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>
        <MockWindow settings={settings} accent={accent} focus={focus} />
      </Animated.View>
      {overlay || shown ? (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { alignItems: "center", justifyContent: "center", opacity: t, transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }] },
          ]}
        >
          {overlay ?? shown}
        </Animated.View>
      ) : null}
    </View>
  );
}
