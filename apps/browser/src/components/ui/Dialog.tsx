import { useEffect, useRef, type ReactNode } from "react";
import { Animated, findNodeHandle, Pressable, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import { curve, duration } from "./motion";
import { Panel } from "./Panel";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { proseLineHeight, radius, shadow, sheetWidth, space, type SheetSize, type Space } from "./tokens";

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
  width: SheetSize;
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
  const surfaceWidth = sheetWidth[width];
  const appear = useRef(new Animated.Value(animated ? 0 : 1)).current;
  const restore = useRef(restoreFocus);
  restore.current = restoreFocus;
  useEffect(() => {
    if (animated) Animated.timing(appear, { toValue: 1, duration: duration.base, easing: curve.enter, useNativeDriver: true }).start();
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
      radius={radius.sheet}
      shadow={shadow.dialog}
      style={place ? { position: "absolute", ...place, width: surfaceWidth, padding } : { width: surfaceWidth, maxHeight, padding }}
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

export function Sheet({ size = "m", onClose, children }: { size?: SheetSize; onClose: () => void; children: ReactNode }) {
  return (
    <Dialog width={size} maxHeight="90%" onDismiss={onClose}>
      {children}
    </Dialog>
  );
}

const TITLE_ROW = { flexDirection: "row", alignItems: "center", gap: space.l } as const;
const TITLE_TEXT = { flex: 1 } as const;
const SUBTITLE = { lineHeight: proseLineHeight.small, marginTop: space.s } as const;

export function DialogTitle({ icon, subtitle, children }: { icon?: ReactNode; subtitle?: ReactNode; children: ReactNode }) {
  const title = (
    <Text size="title" weight="semibold">
      {children}
    </Text>
  );
  const sub =
    subtitle == null || subtitle === false ? null : typeof subtitle === "string" ? (
      <Text size="small" tone="textSecondary" style={SUBTITLE}>
        {subtitle}
      </Text>
    ) : (
      subtitle
    );
  if (!icon)
    return (
      <View>
        {title}
        {sub}
      </View>
    );
  return (
    <View style={TITLE_ROW}>
      {icon}
      <View style={TITLE_TEXT}>
        {title}
        {sub}
      </View>
    </View>
  );
}

const ACTIONS = { flexDirection: "row", alignItems: "center", gap: space.m, marginTop: space.xl } as const;
const ACTIONS_GAP = { flex: 1 } as const;

export function DialogActions({ leading, note, children }: { leading?: ReactNode; note?: ReactNode; children: ReactNode }) {
  return (
    <View style={ACTIONS}>
      {leading}
      {note == null || note === false ? (
        <View style={ACTIONS_GAP} />
      ) : (
        <View style={ACTIONS_GAP}>
          {typeof note === "string" ? (
            <Text size="caption" tone="textSecondary">
              {note}
            </Text>
          ) : (
            note
          )}
        </View>
      )}
      {children}
    </View>
  );
}
