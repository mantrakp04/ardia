import { OutsidePressArea, Surface, Symbol, VisualEffect } from "@ardia/shell";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { closeThemePanel, useThemePanel } from "./panelState";
import { layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import { ThemeSection } from "../settings/ThemeEditor";

export { closeThemePanel, closeThemePanelIn, openThemePanel, toggleThemePanel, useThemePanel } from "./panelState";

const WIDTH = 580;
const MIN_WIDTH = 360;
const EDGE = 14;
const RADIUS = 18;
const ESCAPE = [{ key: "Escape" }];

export function ThemePanelHost() {
  const windowId = useWindowId();
  const profileId = useThemePanel((s) => s.open[windowId]);
  const [shown, setShown] = useState(profileId);
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (profileId) {
      setShown(profileId);
      Animated.spring(appear, { toValue: 1, speed: 22, bounciness: 5, useNativeDriver: true }).start();
      return;
    }
    Animated.timing(appear, { toValue: 0, duration: 160, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
      if (finished) setShown(undefined);
    });
  }, [profileId]);
  const target = profileId ?? shown;
  return target ? <ThemePanel windowId={windowId} profileId={target} appear={appear} /> : null;
}

function ThemePanel({ windowId, profileId, appear }: { windowId: string; profileId: string; appear: Animated.Value }) {
  const shownProfile = useBrowser((s) => s.windows[windowId]?.profileId);
  useEffect(() => {
    if (shownProfile && shownProfile !== profileId) closeThemePanel(windowId);
  }, [shownProfile, profileId, windowId]);
  const theme = useTheme();
  const name = useBrowser((s) => s.profiles[profileId]?.name ?? "");
  const sidebarShown = useBrowser((s) => {
    const w = s.windows[windowId];
    return !!w?.sidebarOpen && (w.tabLayout ?? s.settings.tabLayout) !== "top";
  });
  const sidebarWidth = useBrowser((s) => s.settings.sidebarWidth ?? layout.sidebarWidth);
  const screen = useWindowDimensions();
  const left = (sidebarShown ? sidebarWidth : 0) + EDGE;
  const width = Math.max(MIN_WIDTH, Math.min(WIDTH, screen.width - left - EDGE));
  const keys = useRef<View>(null);
  useEffect(() => {
    keys.current?.focus();
  }, []);
  const close = () => closeThemePanel(windowId);
  return (
    <Animated.View
      style={{
        position: "absolute",
        left,
        top: 52,
        width,
        maxHeight: "86%",
        opacity: appear,
        transform: [
          { translateX: appear.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) },
          { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
        ],
      }}
    >
      <OutsidePressArea onOutsidePress={close}>
        <Surface
          fill="#00000000"
          cornerRadius={RADIUS}
          shadowColor="#000000"
          shadowOpacity={theme.dark ? 0.5 : 0.2}
          shadowRadius={30}
          shadowOffset={[0, 12]}
          style={StyleSheet.absoluteFill}
        />
        <VisualEffect material="popover" cornerRadius={RADIUS} style={StyleSheet.absoluteFill} />
        <View
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: RADIUS, borderWidth: 0.5, borderColor: theme.panelBorder, backgroundColor: theme.dark ? "#242426" : "#FFFFFF" },
          ]}
        />
        <View
          ref={keys}
          focusable
          enableFocusRing={false}
          keyDownEvents={ESCAPE}
          onKeyDown={(e) => e.nativeEvent.key === "Escape" && close()}
          style={{ borderRadius: RADIUS, overflow: "hidden" }}
        >
          <View style={{ height: 44, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 8 }}>
            <Symbol name="paintpalette" size={14} color={theme.textSecondary} style={{ width: 18, height: 18 }} />
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: "700", color: theme.textPrimary }}>
              {name} Theme
            </Text>
            <Pressable onPress={close} tooltip="Done (Esc)">
              <Symbol name="xmark.circle.fill" size={16} color={theme.textTertiary} style={{ width: 20, height: 20 }} />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 620 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}>
            <ThemeSection key={profileId} profileId={profileId} openEditor />
          </ScrollView>
        </View>
      </OutsidePressArea>
    </Animated.View>
  );
}
