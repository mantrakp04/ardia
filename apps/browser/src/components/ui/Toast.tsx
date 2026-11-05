import { useEffect, useRef } from "react";
import { Animated, View } from "react-native";
import { Button } from "./Button";
import { curve, duration, springs } from "./motion";
import { Symbol } from "./native";
import { Panel } from "./Panel";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { radius, shadow, space, toastLayout } from "./tokens";

const DOCK = { position: "absolute", left: 0, right: 0, bottom: toastLayout.bottom, alignItems: "center" } as const;
const BODY = { paddingHorizontal: space.xl, paddingVertical: space.ml, flexDirection: "row", alignItems: "center", gap: space.ml, maxWidth: toastLayout.maxWidth } as const;
const ICON = { width: 20, height: 20 } as const;
const TEXT = { flexShrink: 1 } as const;

export function Toast({
  title,
  message,
  icon,
  action,
  onAction,
  closing = false,
  onClosed,
}: {
  title: string;
  message?: string;
  icon?: string;
  action?: string;
  onAction?: () => void;
  closing?: boolean;
  onClosed?: () => void;
}) {
  const theme = useTheme();
  const appear = useRef(new Animated.Value(0)).current;
  const closed = useRef(onClosed);
  closed.current = onClosed;
  useEffect(() => {
    const run = closing
      ? Animated.timing(appear, { toValue: 0, duration: duration.slow, easing: curve.exit, useNativeDriver: true })
      : Animated.spring(appear, { toValue: 1, ...springs.bouncy, useNativeDriver: true });
    run.start(({ finished }) => finished && closing && closed.current?.());
    return () => run.stop();
  }, [closing]);
  return (
    <View pointerEvents={action && !closing ? "box-none" : "none"} style={DOCK}>
      <Animated.View
        style={{
          opacity: appear,
          transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [toastLayout.rise, 0] }) }, { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
        }}
      >
        <Panel fill={theme.toastFill} border={theme.popoverBorder} radius={radius.panel} shadow={shadow.card} material="hudWindow" style={BODY}>
          {icon ? <Symbol name={icon} size={15} color={theme.icon} style={ICON} /> : null}
          <View style={TEXT}>
            <Text weight="semibold">{title}</Text>
            {message ? (
              <Text size="small" tone="textSecondary">
                {message}
              </Text>
            ) : null}
          </View>
          {action && onAction ? <Button variant="pill" tone="chip" title={action} onPress={onAction} /> : null}
        </Panel>
      </Animated.View>
    </View>
  );
}
