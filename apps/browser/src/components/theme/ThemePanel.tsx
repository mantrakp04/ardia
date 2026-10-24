import { OutsidePressArea, Surface, Symbol, VisualEffect } from "@ardia/shell";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { closeThemePanel, useThemePanel } from "./panelState";
import { layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import { ThemeSection } from "../settings/ThemeEditor";

export { closeThemePanel, openThemePanel, toggleThemePanel, useThemePanel } from "./panelState";

const WIDTH = 580;
const RADIUS = 18;

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
  const sidebarOpen = useBrowser((s) => !!s.windows[windowId]?.sidebarOpen);
  const sidebarWidth = useBrowser((s) => s.settings.sidebarWidth ?? layout.sidebarWidth);
  const close = () => closeThemePanel(windowId);
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: (sidebarOpen ? sidebarWidth : 0) + 14,
        top: 52,
        width: WIDTH,
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
        <View style={{ borderRadius: RADIUS, overflow: "hidden" }}>
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
            <ThemeSection profileId={profileId} openEditor />
          </ScrollView>
        </View>
      </OutsidePressArea>
    </Animated.View>
  );
}
