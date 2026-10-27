import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { stopCliControl, useCliIndicator } from "../../state/app/cliControl";
import { useTheme } from "../ui/theme";
import { font, Panel, space, Symbol, useHover, weight } from "../ui";
import { CLI_PILL_MOTION, SHADOWS } from "./tokens";

const PILL_HEIGHT = 32;
const PILL_BOTTOM = 12;

export function CliControlPill({ style }: { style?: Animated.WithAnimatedValue<ViewStyle> }) {
  const shown = useCliIndicator((s) => s.shown);
  const [mounted, setMounted] = useState(shown);
  const [appearAtOnce, setAppearAtOnce] = useState(shown);
  useEffect(() => {
    if (shown) setMounted(true);
  }, [shown]);
  if (!mounted && !shown) return null;
  return (
    <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, style]}>
      <ShownCliControlPill
        shown={shown}
        appearAtOnce={appearAtOnce}
        onHidden={() => {
          setMounted(false);
          setAppearAtOnce(false);
        }}
      />
    </Animated.View>
  );
}

function ShownCliControlPill({ shown, appearAtOnce, onHidden }: { shown: boolean; appearAtOnce: boolean; onHidden: () => void }) {
  const theme = useTheme();
  const appear = useRef(new Animated.Value(appearAtOnce ? 1 : 0)).current;
  useEffect(() => {
    const animation = Animated.timing(
      appear,
      shown
        ? { toValue: 1, ...CLI_PILL_MOTION.show, useNativeDriver: true }
        : { toValue: 0, ...CLI_PILL_MOTION.hide, useNativeDriver: true },
    );
    animation.start(({ finished }) => finished && !shown && onHidden());
    return () => animation.stop();
  }, [shown]);
  return (
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
