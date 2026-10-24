import { pickFiles, Surface, Symbol } from "@ardia/shell";
import { useEffect, useRef } from "react";
import { Animated, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { create } from "zustand";
import { hex, useTheme } from "../../lib/theme";
import { PERSONALIZE_COPY, TabLayoutPicker, ThemeColorPicker } from "../onboarding/personalize";
import { useHover } from "../primitives";
import { ARTWORKS } from "../../lib/ntpArtwork";
import { useBrowser } from "../../store/browser";
import { Toggle } from "../settings/controls";

const INSET = 16;
const BUTTON = 30;
const GLYPH_DROP = 1.5;

const usePanel = create<{ windowId: string | null }>(() => ({ windowId: null }));
const setOpen = (windowId: string | null) => usePanel.setState({ windowId });

export function PersonalizeButton({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const open = usePanel((s) => s.windowId === windowId);
  useEffect(() => () => {
    if (usePanel.getState().windowId === windowId) setOpen(null);
  }, [windowId]);
  return (
    <>
      {open ? <PersonalizePanel windowId={windowId} onClose={() => setOpen(null)} /> : null}
      <View {...hoverProps} tooltip="Personalize" style={{ position: "absolute", right: INSET, bottom: INSET - GLYPH_DROP }}>
        <Pressable onPress={() => setOpen(open ? null : windowId)} accessibilityRole="button" accessibilityLabel="Personalize" accessibilityState={{ expanded: open }}>
          {({ pressed }) => (
            <View
              style={{
                width: BUTTON,
                height: BUTTON,
                borderRadius: BUTTON / 2,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed ? theme.toolbarPressed : hovered || open ? theme.toolbarHover : undefined,
              }}
            >
              <Symbol name="paintpalette" size={14} color={hovered || open ? theme.icon : theme.textTertiary} style={{ width: BUTTON, height: BUTTON }} />
            </View>
          )}
        </Pressable>
      </View>
    </>
  );
}

function SwitchLine({ title, setting }: { title: string; setting: "ntpSuggestions" | "ntpGreetingName" }) {
  const theme = useTheme();
  const value = useBrowser((s) => s.settings[setting]);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={{ fontSize: 12.5, color: theme.textPrimary }}>{title}</Text>
      <Toggle value={value} onChange={(v) => useBrowser.getState().updateSettings({ [setting]: v })} />
    </View>
  );
}

const THUMB_W = 66;
const THUMB_H = 44;

function BackgroundPicker() {
  const theme = useTheme();
  const background = useBrowser((s) => s.settings.ntpBackground);
  const customPath = useBrowser((s) => s.settings.ntpBackgroundPath);
  const choose = (ntpBackground: string) => useBrowser.getState().updateSettings({ ntpBackground });
  const chooseFile = () =>
    void pickFiles().then((paths) => {
      const path = paths.find((p) => /\.(png|jpe?g|heic|webp|gif|tiff?)$/i.test(p));
      if (path) useBrowser.getState().updateSettings({ ntpBackground: "custom", ntpBackgroundPath: path });
    });
  const ring = (on: boolean) => ({ borderWidth: on ? 2 : StyleSheet.hairlineWidth * 2, borderColor: on ? theme.accent : theme.panelBorder });
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 12, color: theme.textSecondary }}>Background</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Pressable onPress={() => choose("none")} tooltip="No background">
          <View style={[{ width: THUMB_W, height: THUMB_H, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: theme.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" }, ring(background === "none")]}>
            <Symbol name="circle.slash" size={14} color={theme.textSecondary} style={{ width: 18, height: 18 }} />
          </View>
        </Pressable>
        {ARTWORKS.map((art) => (
          <Pressable key={art.id} onPress={() => choose(art.id)} tooltip={`${art.title}, ${art.artist}`}>
            <View style={[{ width: THUMB_W, height: THUMB_H, borderRadius: 8, overflow: "hidden" }, ring(background === art.id)]}>
              <Image source={art.source} resizeMode="cover" style={StyleSheet.absoluteFill} />
            </View>
          </Pressable>
        ))}
        <Pressable onPress={chooseFile} tooltip="Choose an image…">
          <View style={[{ width: THUMB_W, height: THUMB_H, borderRadius: 8, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: theme.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" }, ring(background === "custom")]}>
            {background === "custom" && customPath ? <Image source={{ uri: `file://${encodeURI(customPath)}` }} resizeMode="cover" style={StyleSheet.absoluteFill} /> : null}
            <Symbol name="photo.badge.plus" size={14} color={background === "custom" ? "#FFFFFF" : theme.textSecondary} style={{ width: 20, height: 18 }} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

function PersonalizePanel({ windowId, onClose }: { windowId: string; onClose: () => void }) {
  const theme = useTheme();
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(t, { toValue: 1, friction: 9, tension: 90, useNativeDriver: true }).start();
  }, []);
  return (
    <>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close Personalize" />
      <Animated.View
        style={{
          position: "absolute",
          right: INSET,
          bottom: INSET + BUTTON + 8,
          width: 388,
          opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }),
          transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }, { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }],
        }}
      >
        <Surface
          fill={hex(theme.panel)}
          cornerRadius={16}
          borderColor={hex(theme.panelBorder)}
          borderWidth={0.5}
          shadowColor="#000000"
          shadowOpacity={theme.panelShadowOpacity}
          shadowRadius={24}
          shadowOffset={[0, 10]}
        >
          <View style={{ padding: 18, gap: 16 }}>
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>{PERSONALIZE_COPY.title}</Text>
              <Text style={{ fontSize: 12, lineHeight: 17, color: theme.textSecondary }}>{PERSONALIZE_COPY.subtitle}</Text>
            </View>
            <ThemeColorPicker windowId={windowId} size={28} />
            <BackgroundPicker />
            <View style={{ gap: 10 }}>
              <SwitchLine title="Suggestions on this page" setting="ntpSuggestions" />
              <SwitchLine title="Greet me by name" setting="ntpGreetingName" />
            </View>
            <View style={{ gap: 8 }}>
              <Text style={{ fontSize: 12, color: theme.textSecondary }}>{PERSONALIZE_COPY.layouts}</Text>
              <TabLayoutPicker windowId={windowId} />
            </View>
          </View>
        </Surface>
      </Animated.View>
    </>
  );
}

if (__DEV__) (globalThis as { acPersonalize?: unknown }).acPersonalize = { open: setOpen };
