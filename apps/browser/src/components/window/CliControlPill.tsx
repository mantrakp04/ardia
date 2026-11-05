import { Animated, StyleSheet, View, type ViewStyle } from "react-native";
import { stopCliControl, useCliIndicator } from "../../state/app/cliControl";
import { useTheme } from "../ui/theme";
import { Button, Dot, space, Symbol, Text, usePresence } from "../ui";
import { Hud } from "./Hud";
import { CLI_PILL_MOTION } from "./tokens";

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
          <Hud shape="capsule" height={PILL_HEIGHT} accessibilityRole="alert" accessibilityLabel="The ardia command is controlling Ardia">
            <View style={PILL_ROW}>
              <Dot size={TERMINAL_DOT} color={theme.textPrimary}>
                <Symbol name="terminal.fill" size={9} weight="bold" color={theme.onPrimary} style={TERMINAL_GLYPH} />
              </Dot>
              <Text numberOfLines={1} size="small" tone="textSecondary" style={SHRINK}>
                <Text size="small" weight="semibold">
                  ardia
                </Text>
                {" is controlling Ardia"}
              </Text>
              <Button variant="pill" tone="chip" title="Stop" onPress={stopCliControl} />
            </View>
          </Hud>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const TERMINAL_DOT = 20;
const TERMINAL_GLYPH = { width: 14, height: 14 } as const;
const SHRINK = { flexShrink: 1 } as const;
const PILL_ROW = { height: PILL_HEIGHT, flexDirection: "row", alignItems: "center", gap: space.m, paddingLeft: space.s, paddingRight: space.xs } as const;
