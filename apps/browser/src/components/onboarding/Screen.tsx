import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { PROFILE_COLORS } from "../ui/theme";
import { themeAccent } from "../../lib/profileLook";
import { curve } from "../ui/motion";
import { onboardingMotion } from "./tokens";
import { useSettings, useTabLayout } from "../../state/browser/hooks";
import { useWindowProfileValue } from "../../state/profiles/hooks";
import type { Settings } from "../../state/settings/settings";
import { MockWindow, type PreviewId } from "./previews";
import { resolveDraft, useOnboarding } from "../../state/onboarding/onboarding";

export function useScreen<K extends keyof Settings>(keys: readonly K[]) {
  const windowId = useOnboarding((s) => s.windowId);
  const draft = useOnboarding((s) => s.draft);
  const preset = useOnboarding((s) => s.preset);
  const settings = useSettings((st) => st);
  const tabLayout = useTabLayout(windowId);
  const base = { ...settings, tabLayout };
  const values = resolveDraft(keys, draft, preset, base);
  return { values, base, mock: { ...base, ...values } as Settings };
}

export function useAccent() {
  const windowId = useOnboarding((s) => s.windowId);
  return useWindowProfileValue(windowId ?? "", (p) => (p?.theme ? themeAccent(p.theme) : (PROFILE_COLORS[p?.color ?? "plum"] ?? PROFILE_COLORS.plum).swatch));
}

const MOCK_SIZE = { width: 420, height: 300 } as const;

export function MockPanel({ settings, focus, overlay }: { settings: Partial<Settings>; focus: PreviewId | null; overlay?: ReactNode }) {
  const accent = useAccent();
  const t = useRef(new Animated.Value(overlay ? 1 : 0)).current;
  const [shown, setShown] = useState(overlay);
  useEffect(() => {
    if (overlay) setShown(overlay);
    Animated.timing(t, { toValue: overlay ? 1 : 0, duration: onboardingMotion.mockOverlay, easing: curve.outCubic, useNativeDriver: true }).start(({ finished }) => {
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
