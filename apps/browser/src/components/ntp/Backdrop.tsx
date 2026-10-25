import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { ntpBackgroundSource } from "../../lib/ntpArtwork";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";

export function useNtpBackdrop() {
  const windowId = useWindowId();
  const incognito = useBrowser((s) => !!s.windows[windowId]?.incognito);
  const background = useBrowser((s) => s.settings.ntpBackground);
  const customPath = useBrowser((s) => s.settings.ntpBackgroundPath);
  return useMemo(() => (incognito ? null : ntpBackgroundSource(background, customPath)), [incognito, background, customPath]);
}

export function NtpBackdrop({ radius }: { radius: number }) {
  const source = useNtpBackdrop();
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    fade.setValue(0);
  }, [source]);
  if (!source) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: "hidden" }]}>
      <Animated.Image
        source={source}
        resizeMode="cover"
        onLoad={() => Animated.timing(fade, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()}
        style={[StyleSheet.absoluteFill, { opacity: fade, transform: [{ scale: fade.interpolate({ inputRange: [0, 1], outputRange: [1.03, 1] }) }] }]}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.22)" }]} />
    </View>
  );
}
