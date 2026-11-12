import { useEffect, useState } from "react";
import { Animated, Image, StyleSheet, View, type ViewStyle } from "react-native";
import { stopCliControl, useCliIndicator } from "../../state/app/cliControl";
import { controlLine, controlLineText } from "../../state/app/cliCaller";
import { fileIcon } from "../../state/app/system";
import { useTheme } from "../ui/theme";
import { Button, Dot, space, Symbol, Text, usePresence } from "../ui";
import { Hud } from "./Hud";
import { CLI_PILL_MOTION } from "./tokens";

const PILL_HEIGHT = 32;
const PILL_BOTTOM = 12;

export function CliControlPill({ style }: { style?: Animated.WithAnimatedValue<ViewStyle> }) {
  const theme = useTheme();
  const shown = useCliIndicator((s) => s.shown);
  const caller = useCliIndicator((s) => s.caller);
  const icon = useAppIcon(caller?.app ?? null);
  const line = controlLine(caller);
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
          <Hud shape="capsule" height={PILL_HEIGHT} accessibilityRole="alert" accessibilityLabel={controlLineText(line)}>
            <View style={PILL_ROW}>
              {icon ? (
                <Image source={{ uri: icon }} style={APP_ICON} />
              ) : (
                <Dot size={TERMINAL_DOT} color={theme.textPrimary}>
                  <Symbol name="terminal.fill" size={9} weight="bold" color={theme.onPrimary} style={TERMINAL_GLYPH} />
                </Dot>
              )}
              <Text numberOfLines={1} size="small" tone="textSecondary" style={SHRINK}>
                {line.lead}
                <Text size="small" weight="semibold">
                  {line.name}
                </Text>
                {line.rest}
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
const APP_ICON = { width: TERMINAL_DOT, height: TERMINAL_DOT } as const;
const TERMINAL_GLYPH = { width: 14, height: 14 } as const;
const SHRINK = { flexShrink: 1 } as const;
const PILL_ROW = { height: PILL_HEIGHT, flexDirection: "row", alignItems: "center", gap: space.m, paddingLeft: space.s, paddingRight: space.xs } as const;

const appIcons = new Map<string, string | null>();

function useAppIcon(app: string | null) {
  const [icon, setIcon] = useState(() => (app ? (appIcons.get(app) ?? null) : null));
  useEffect(() => {
    if (!app) return setIcon(null);
    if (appIcons.has(app)) return setIcon(appIcons.get(app) ?? null);
    let live = true;
    void fileIcon(app, TERMINAL_DOT)
      .catch(() => null)
      .then((uri) => {
        appIcons.set(app, uri);
        if (live) setIcon(uri);
      });
    return () => {
      live = false;
    };
  }, [app]);
  return icon;
}
