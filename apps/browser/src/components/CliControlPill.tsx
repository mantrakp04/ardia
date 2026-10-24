import { Surface, Symbol } from "@ardia/shell";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, Text, View } from "react-native";
import { useStore } from "zustand";
import { cliDisclosure, stopCliControl } from "../lib/cliControl";
import { hex, useTheme } from "../lib/theme";
import { useWindowId } from "../store/hooks";
import {
  CLI_PILL_BOTTOM,
  CLI_PILL_HEIGHT,
  CLI_PILL_INSET,
  cliPillColors,
  cliPillLabel,
  cliPillPlacements,
  cliPillWidthSeed,
  placeCliPill,
  withdrawCliPill,
  type CliPillLabel,
  type CliPillPlacements,
} from "./layout/cliPillLayout";
import { useHover } from "./primitives";

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled().then((on) => (reduceMotion = on), () => {});
AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => (reduceMotion = on));

export const useCliDisclosed = () => useStore(cliDisclosure, (s) => s.shown);

export const useCliPillPlacements = <T,>(select: (placements: CliPillPlacements) => T) => useStore(cliPillPlacements, select);

export function useCliToastLift(lift: number): Animated.Value {
  const offset = useRef(new Animated.Value(-lift)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const animation = Animated.timing(offset, { toValue: -lift, duration: reduceMotion ? 0 : 180, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [lift]);
  return offset;
}

export function CliControlPill({ tabId, paneWidth }: { tabId: string; paneWidth: number }) {
  const windowId = useWindowId();
  const shown = useCliDisclosed();
  const [appearAtOnce, setAppearAtOnce] = useState(shown);
  const [mounted, setMounted] = useState(shown);
  const [width, setWidth] = useState(() => cliPillWidthSeed(windowId, shown));
  const [owner] = useState(() => ({}));
  useEffect(() => {
    if (shown) setMounted(true);
  }, [shown]);
  useLayoutEffect(() => {
    if (mounted && width > 0) placeCliPill(windowId, owner, tabId, width);
    else withdrawCliPill(windowId, owner);
  }, [shown, mounted, width, windowId, tabId]);
  useLayoutEffect(() => () => withdrawCliPill(windowId, owner), [windowId]);
  if (!mounted && !shown) return null;
  return (
    <ShownCliControlPill
      shown={shown}
      appearAtOnce={appearAtOnce}
      label={cliPillLabel(paneWidth)}
      onHidden={() => {
        setMounted(false);
        setWidth(0);
        setAppearAtOnce(false);
      }}
      onWidth={setWidth}
    />
  );
}

function ShownCliControlPill({
  shown,
  appearAtOnce,
  label,
  onHidden,
  onWidth,
}: {
  shown: boolean;
  appearAtOnce: boolean;
  label: CliPillLabel;
  onHidden: () => void;
  onWidth: (width: number) => void;
}) {
  const theme = useTheme();
  const colors = cliPillColors(theme);
  const appear = useRef(new Animated.Value(appearAtOnce ? 1 : 0)).current;
  useEffect(() => {
    const animation = Animated.timing(
      appear,
      shown
        ? { toValue: 1, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }
        : { toValue: 0, duration: 200, easing: Easing.in(Easing.quad), useNativeDriver: true },
    );
    animation.start(({ finished }) => finished && !shown && onHidden());
    return () => animation.stop();
  }, [shown]);
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: CLI_PILL_INSET, right: CLI_PILL_INSET, bottom: CLI_PILL_BOTTOM, alignItems: "center" }}>
      <Animated.View
        pointerEvents={shown ? "auto" : "none"}
        onLayout={(e) => onWidth(e.nativeEvent.layout.width)}
        style={{
          maxWidth: "100%",
          opacity: appear,
          transform: reduceMotion
            ? []
            : [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }, { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
        }}
      >
        <Surface
          fill={hex(colors.fill)}
          cornerRadius={CLI_PILL_HEIGHT / 2}
          borderColor={hex(colors.border)}
          borderWidth={0.5}
          shadowColor="#000000"
          shadowOpacity={theme.panelShadowOpacity}
          shadowRadius={14}
          shadowOffset={[0, 4]}
        >
          <View
            accessibilityRole="alert"
            accessibilityLabel="The ardia command is controlling Ardia"
            style={{ height: CLI_PILL_HEIGHT, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 6, paddingRight: 4 }}
          >
            {label.glyph ? (
              <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: colors.glyphFill, alignItems: "center", justifyContent: "center" }}>
                <Symbol name="terminal.fill" size={9} weight="bold" color={colors.glyph} style={{ width: 14, height: 14 }} />
              </View>
            ) : null}
            <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12, color: colors.detail, marginLeft: label.glyph ? 0 : 6 }}>
              <Text style={{ fontWeight: "600", color: colors.title }}>ardia</Text>
              {label.detail}
            </Text>
            <StopButton colors={colors} />
          </View>
        </Surface>
      </Animated.View>
    </View>
  );
}

function StopButton({ colors }: { colors: ReturnType<typeof cliPillColors> }) {
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={stopCliControl} accessibilityRole="button" accessibilityLabel="Stop">
        {({ pressed }) => (
          <View
            style={{
              height: CLI_PILL_HEIGHT - 8,
              paddingHorizontal: 10,
              borderRadius: (CLI_PILL_HEIGHT - 8) / 2,
              justifyContent: "center",
              backgroundColor: colors.stopFill(pressed ? "pressed" : hovered ? "hovered" : "rest"),
            }}
          >
            <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "500", color: colors.stopText }}>
              Stop
            </Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}
