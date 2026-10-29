import { useEffect, useRef, type ReactNode } from "react";
import { Animated, findNodeHandle, Pressable, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import { curve, duration } from "./motion";
import { Panel } from "./Panel";
import { useTheme } from "./theme";
import { radius, shadow, space, type Space } from "./tokens";

const CENTERED: StyleProp<ViewStyle> = [StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }];

export function Dialog({
  width,
  pad = "xxl",
  onDismiss,
  onSubmit,
  restoreFocus,
  animated = false,
  maxHeight,
  place,
  children,
}: {
  width: number;
  pad?: Space;
  onDismiss?: () => void;
  onSubmit?: () => void;
  restoreFocus?: () => void;
  animated?: boolean;
  maxHeight?: DimensionValue;
  place?: Pick<ViewStyle, "top" | "left" | "right" | "bottom">;
  children: ReactNode;
}) {
  const theme = useTheme();
  const appear = useRef(new Animated.Value(animated ? 0 : 1)).current;
  const restore = useRef(restoreFocus);
  restore.current = restoreFocus;
  useEffect(() => {
    if (animated) Animated.timing(appear, { toValue: 1, duration: duration.dialogAppear, easing: curve.outCubic, useNativeDriver: true }).start();
    return () => restore.current?.();
  }, []);
  const content = onSubmit ? (
    <DialogKeys onDismiss={onDismiss} onSubmit={onSubmit} pad={pad}>
      {children}
    </DialogKeys>
  ) : (
    children
  );
  const padding = onSubmit ? undefined : space[pad];
  const surface = (
    <Panel
      fill={theme.panel}
      radius={radius.sheet}
      border={theme.panelBorder}
      shadow={shadow.dialog}
      style={place ? { position: "absolute", ...place, width, padding } : { width, maxHeight, padding }}
    >
      {content}
    </Panel>
  );
  if (place)
    return (
      <View style={StyleSheet.absoluteFill}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
        {surface}
      </View>
    );
  if (!animated)
    return (
      <View style={CENTERED}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }]} onPress={onDismiss} />
        {surface}
      </View>
    );
  return (
    <View style={CENTERED}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: appear, backgroundColor: theme.scrim }]}>
        <Pressable focusable={false} style={StyleSheet.absoluteFill} onPress={onDismiss} />
      </Animated.View>
      <Animated.View style={{ opacity: appear, transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }}>{surface}</Animated.View>
    </View>
  );
}

const DIALOG_KEYS = [{ key: "Escape" }, { key: "Enter" }, { key: "Tab" }, { key: "Tab", shiftKey: true }];
const targetTag = (event: object) => (event as { target?: number }).target;

function DialogKeys({ onDismiss, onSubmit, pad, children }: { onDismiss?: () => void; onSubmit: () => void; pad: Space; children: ReactNode }) {
  const keys = useRef<View>(null);
  useEffect(() => keys.current?.focus(), []);
  return (
    <View
      ref={keys}
      focusable
      enableFocusRing={false}
      keyDownEvents={DIALOG_KEYS}
      onKeyDown={(e) => {
        if (e.nativeEvent.key === "Escape") onDismiss?.();
        else if (e.nativeEvent.key === "Enter" && targetTag(e.nativeEvent) === findNodeHandle(keys.current)) onSubmit();
      }}
      style={{ padding: space[pad] }}
    >
      {children}
    </View>
  );
}

export function Sheet({ width = 440, onClose, children }: { width?: number; onClose: () => void; children: ReactNode }) {
  return (
    <Dialog width={width} maxHeight="90%" onDismiss={onClose}>
      {children}
    </Dialog>
  );
}
