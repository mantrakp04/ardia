import { Animated, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { stopCliControl, useCliIndicator } from "../../state/app/cliControl";
import { useTheme } from "../ui/theme";
import { font, Panel, space, Symbol, useHover, usePresence, weight } from "../ui";
import { CLI_PILL_MOTION, SHADOWS } from "./tokens";

const PILL_HEIGHT = 32;
const PILL_BOTTOM = 12;

export function CliControlPill({ style }: { style?: Animated.WithAnimatedValue<ViewStyle> }) {
  const theme = useTheme();
  const shown = useCliIndicator((s) => s.shown);
  const { shown: mounted, appear } = usePresence(shown || null, CLI_PILL_MOTION);
  if (!mounted) return null;
  return (
    <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, style]}>
      <View pointerEvents="box-none" style={{ position: "absolute", left: space.l, right: space.l, bottom: PILL_BOTTOM, alignItems: "center" }}>
        <Animated.View
          pointerEvents={shown ? "auto" : "none"}
          style={{
            maxWidth: "100%",
            opacity: appear,
            transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }, { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
          }}
        >
          <Panel fill={theme.panel} radius={PILL_HEIGHT / 2} border={theme.panelBorder} shadow={SHADOWS.cliPill}>
            <View
              accessibilityRole="alert"
              accessibilityLabel="The ardia command is controlling Ardia"
              style={{ height: PILL_HEIGHT, flexDirection: "row", alignItems: "center", gap: space.m, paddingLeft: space.s, paddingRight: space.xs }}
            >
              <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: theme.textPrimary, alignItems: "center", justifyContent: "center" }}>
                <Symbol name="terminal.fill" size={9} weight="bold" color={theme.onPrimary} style={{ width: 14, height: 14 }} />
              </View>
              <Text numberOfLines={1} style={{ flexShrink: 1, ...font.small, color: theme.textSecondary }}>
                <Text style={{ fontWeight: weight.semibold, color: theme.textPrimary }}>ardia</Text>
                {" is controlling Ardia"}
              </Text>
              <StopButton />
            </View>
          </Panel>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

function StopButton() {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={stopCliControl} accessibilityRole="button" accessibilityLabel="Stop">
        {({ pressed }) => (
          <View
            style={{
              height: PILL_HEIGHT - 8,
              paddingHorizontal: space.ml,
              borderRadius: (PILL_HEIGHT - 8) / 2,
              justifyContent: "center",
              backgroundColor: pressed ? theme.toolbarPressed : hovered ? theme.toolbarHover : theme.urlPill,
            }}
          >
            <Text numberOfLines={1} style={{ ...font.small, fontWeight: weight.medium, color: theme.textPrimary }}>
              Stop
            </Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}
