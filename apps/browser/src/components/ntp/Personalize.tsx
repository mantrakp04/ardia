import { devRegister } from "../dev/devRegister";
import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { PERSONALIZE_COPY, TabLayoutPicker, ThemeColorPicker } from "../onboarding/Personalize";
import { Box, Panel, shadow, space, Symbol, Text, useHover, useTheme } from "../ui";
import { ntpType, PERSONALIZE_PANEL } from "./tokens";
import { closePersonalizePanelOf, setPersonalizePanel as setOpen, usePersonalizePanel } from "../../state/pages/personalizePanel";

const INSET = 16;
const BUTTON = 30;
const GLYPH_DROP = 1.5;
const PANEL_WIDTH = 352;
const SUBTITLE_LINE = 17;

export function PersonalizeButton({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const open = usePersonalizePanel((s) => s.windowId === windowId);
  useEffect(() => () => closePersonalizePanelOf(windowId), [windowId]);
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

function PersonalizePanel({ windowId, onClose }: { windowId: string; onClose: () => void }) {
  const theme = useTheme();
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(t, { toValue: 1, ...PERSONALIZE_PANEL.spring, useNativeDriver: true }).start();
  }, []);
  return (
    <>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close Personalize" />
      <Animated.View
        style={{
          position: "absolute",
          right: INSET,
          bottom: INSET + BUTTON + space.m,
          width: PANEL_WIDTH,
          opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }),
          transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }, { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }],
        }}
      >
        <Panel fill={theme.panel} radius={PERSONALIZE_PANEL.radius} border={theme.panelBorder} shadow={shadow.dialog}>
          <Box pad="xlx" gap="xl">
            <Box gap="xs">
              <Text style={ntpType.personalizeTitle}>{PERSONALIZE_COPY.title}</Text>
              <Text size="small" tone="textSecondary" style={SUBTITLE}>
                {PERSONALIZE_COPY.subtitle}
              </Text>
            </Box>
            <ThemeColorPicker windowId={windowId} size={28} />
            <Box gap="m">
              <Text size="small" tone="textSecondary">
                {PERSONALIZE_COPY.layouts}
              </Text>
              <TabLayoutPicker windowId={windowId} />
            </Box>
          </Box>
        </Panel>
      </Animated.View>
    </>
  );
}

const SUBTITLE = { lineHeight: SUBTITLE_LINE } as const;

devRegister("acPersonalize", "open", setOpen);
