import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, StyleSheet, View, type ViewStyle } from "react-native";
import { Box, Button, curve, duration, Panel, radius, shadow, springs, Text, useHover } from "../ui";
import { NTP_CARD, useNtpColors } from "./tokens";

const LEAVE_SCALE = 0.98;
const CLOSE_PLACE = { position: "absolute", right: -8, top: -8 } as const;

export function useCardRetire() {
  const [leaving, setLeaving] = useState<null | (() => void)>(null);
  const retire = (action: () => void) =>
    setLeaving(() => () => {
      action();
      setLeaving(null);
    });
  return [leaving, retire] as const;
}

export function NtpCardSlot({ width, height, children }: { width: number; height?: number; children: ReactNode }) {
  return (
    <Box pad="m" style={{ position: "absolute", left: 0, top: 0, width, height }} pointerEvents="box-none">
      {children}
    </Box>
  );
}

export function NtpCardTitle({ children }: { children: string }) {
  const colors = useNtpColors();
  return (
    <Text lines={1} size="body" weight="medium" style={{ color: colors.title }}>
      {children}
    </Text>
  );
}

export function NtpCard({
  appearDelay,
  leaving,
  onClose,
  lift,
  pressed = false,
  style,
  children,
}: {
  appearDelay: number;
  leaving: null | (() => void);
  onClose: () => void;
  lift?: boolean;
  pressed?: boolean;
  style?: ViewStyle;
  children: ReactNode;
}) {
  const { hovered, hoverProps } = useHover();
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: duration.slow, delay: appearDelay, easing: curve.enter, useNativeDriver: true }).start();
  }, []);
  useEffect(() => {
    if (!lift || leaving) return;
    Animated.spring(scale, { toValue: pressed ? LEAVE_SCALE : hovered ? 1.02 : 1, ...springs.bouncy, useNativeDriver: true }).start();
  }, [hovered, pressed, !!leaving]);
  useEffect(() => {
    if (!leaving) return;
    Animated.parallel([
      Animated.timing(scale, { toValue: LEAVE_SCALE, duration: duration.slow, easing: curve.enter, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: duration.slow, easing: curve.enter, useNativeDriver: true }),
    ]).start(() => leaving());
  }, [leaving]);

  return (
    <Animated.View {...hoverProps} style={{ ...style, opacity, transform: [{ scale }] }} pointerEvents={leaving ? "none" : "auto"}>
      {children}
      <View style={[CLOSE_PLACE, { opacity: hovered ? 1 : 0 }]} pointerEvents={hovered ? "auto" : "none"}>
        <Button variant="close" look="hud" onPress={onClose} />
      </View>
    </Animated.View>
  );
}

export function NtpCardSurface() {
  const colors = useNtpColors();
  return (
    <Panel
      style={StyleSheet.absoluteFill}
      fill={colors.cardFill}
      radius={radius.panel}
      border={colors.cardBorder}
      borderWidth={NTP_CARD.border}
      shadow={{ ...shadow.dialog, opacity: colors.cardShadowOpacity }}
    />
  );
}
