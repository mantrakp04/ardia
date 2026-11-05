import { devRegister } from "../dev/devRegister";
import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { PERSONALIZE_COPY, TabLayoutPicker } from "../onboarding/Personalize";
import { ThemePicker } from "../settings/ThemeEditor";
import { useWindowProfileValue } from "../../state/profiles/hooks";
import { Box, capsule, Panel, proseLineHeight, shadow, space, Symbol, Text, useHover, useTheme } from "../ui";
import { PERSONALIZE_PANEL } from "./tokens";
import { closePersonalizePanelOf, setPersonalizePanel as setOpen, usePersonalizePanel } from "../../state/pages/personalizePanel";

const INSET = space.xl;
const BUTTON = 30;
const GLYPH_DROP = 1.5;
const PANEL_WIDTH = 352;
const EDITING_PANEL_WIDTH = 432;

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
                borderRadius: capsule(BUTTON),
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
  const t = useRef(new Animated.Value(0)).current;
  const editing = useWindowProfileValue(windowId, (p) => !!p?.theme);
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
          width: editing ? EDITING_PANEL_WIDTH : PANEL_WIDTH,
          opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }),
          transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }, { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }],
        }}
      >
        <Panel radius={PERSONALIZE_PANEL.radius} shadow={shadow.dialog}>
          <Box pad="xl" gap="xl">
            <Box gap="xs">
              <Text size="title" weight="semibold">
                {PERSONALIZE_COPY.title}
              </Text>
              <Text size="small" tone="textSecondary" style={SUBTITLE}>
                {PERSONALIZE_COPY.subtitle}
              </Text>
            </Box>
            <ThemePicker windowId={windowId} size={28} gap={space.xs} />
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

const SUBTITLE = { lineHeight: proseLineHeight.small } as const;

devRegister("acPersonalize", "open", setOpen);
