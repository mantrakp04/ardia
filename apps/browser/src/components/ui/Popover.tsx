import { Symbol, VisualEffect } from "@ardia/shell";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "./Button";
import { PANEL_CLOSE_GLYPH, PANEL_CLOSE_SIZE } from "./ButtonKinds";
import { curve, duration } from "./motion";
import { useTheme } from "./theme";
import { concentric, font as typeScale, lineHeight, POPOVER_WIDTH, radius, shadow, space, weight } from "./tokens";
import { useHover } from "./useHover";
import { Panel, type PanelProps } from "./Panel";
import { useGlass } from "./Glass";

export const POPOVER_MARGIN = space.m;

const INSET = space.xl;
const ROW_INSET = space.s;
const RADIUS = radius.panel;
const ROW_HEIGHT = 32;
const SEPARATOR_GAP = 5;
const ICON_SLOT = 20;
const ICON_GAP = space.ml;
export const PANEL = {
  radius: RADIUS,
  inset: INSET,
  rowInset: ROW_INSET,
  rowPadding: INSET - ROW_INSET,
  rowRadius: concentric(RADIUS, ROW_INSET),
  rowHeight: ROW_HEIGHT,
  iconSlot: ICON_SLOT,
  iconSize: 13,
  iconGap: ICON_GAP,
  textColumn: INSET + ICON_SLOT + ICON_GAP,
  listPadding: INSET - (ROW_HEIGHT - ICON_SLOT) / 2,
  headerGap: space.m,
  separatorGap: SEPARATOR_GAP,
  titleSize: typeScale.body.fontSize,
  titleLine: lineHeight.body,
  subtitleSize: typeScale.caption.fontSize,
  subtitleLine: lineHeight.caption,
  valueSize: typeScale.small.fontSize,
  largeIcon: 32,
} as const;

export const POPOVER_MOTION = {
  open: { duration: duration.base, easing: curve.enter },
  close: { duration: duration.fast, easing: curve.exit },
} as const;

export function usePopoverPresence(open: boolean) {
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  return { shown: open || shown, closing: !open, onClosed: () => setShown(false) };
}

export function usePopoverMotion(closing: boolean, onClosed?: () => void, ready = true) {
  const appear = useRef(new Animated.Value(0)).current;
  const closed = useRef(onClosed);
  closed.current = onClosed;
  useEffect(() => {
    if (!ready) {
      if (closing) closed.current?.();
      return;
    }
    const motion = closing ? POPOVER_MOTION.close : POPOVER_MOTION.open;
    Animated.timing(appear, { toValue: closing ? 0 : 1, duration: motion.duration, easing: motion.easing, useNativeDriver: true }).start(
      ({ finished }) => finished && closing && closed.current?.(),
    );
  }, [closing, ready]);
  return appear;
}

export function usePopoverMotionStyle(appear: Animated.Value, origin: string | [number | string, number | string, number], upward = false) {
  return useMemo(
    () => ({
      opacity: appear,
      transformOrigin: origin,
      transform: [
        { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
        { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: upward ? [4, 0] : [-4, 0] }) },
      ],
    }),
    [appear, origin, upward],
  );
}

export function Popover({
  width,
  top,
  right,
  left,
  onDismiss,
  children,
  modal = true,
  fitHeight = false,
  closing = false,
  onClosed,
  glass = false,
}: {
  width: keyof typeof POPOVER_WIDTH | number;
  top: number;
  right?: number;
  left?: number;
  onDismiss?: () => void;
  children: ReactNode;
  modal?: boolean;
  fitHeight?: boolean;
  closing?: boolean;
  onClosed?: () => void;
  glass?: boolean;
}) {
  const appear = usePopoverMotion(closing, onClosed);
  const motion = usePopoverMotionStyle(appear, right !== undefined ? "top right" : "top left");
  const [room, setRoom] = useState<number | null>(null);
  return (
    <>
      {fitHeight && <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e) => setRoom(e.nativeEvent.layout.height)} />}
      {modal && onDismiss && !closing && <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />}
      <Animated.View pointerEvents={closing ? "none" : "auto"} style={{ position: "absolute", top, right, left, width: typeof width === "number" ? width : POPOVER_WIDTH[width], ...motion }}>
        <PopoverSurface glass={glass}>
          {fitHeight ? <ScrollView showsVerticalScrollIndicator={false} style={room === null ? undefined : { maxHeight: Math.max(0, room - top - POPOVER_MARGIN) }}>{children}</ScrollView> : children}
        </PopoverSurface>
      </Animated.View>
    </>
  );
}

export function PopoverSurface({ children, glass = false, ...props }: Omit<PanelProps, "fill" | "radius" | "border" | "borderWidth" | "shadow" | "glass"> & { glass?: boolean }) {
  const theme = useTheme();
  const paneGlass = useGlass("panes");
  if (glass && paneGlass)
    return (
      <Panel {...props} glass fill={theme.panel} radius={PANEL.radius}>
        {children}
      </Panel>
    );
  return (
    <Panel {...props} fill={theme.popoverFill} radius={PANEL.radius} border={theme.popoverBorder} shadow={shadow.popover}>
      <VisualEffect material="menu" cornerRadius={PANEL.radius} style={StyleSheet.absoluteFill} />
      <View style={{ ...StyleSheet.absoluteFillObject, borderRadius: PANEL.radius, backgroundColor: theme.popoverTint }} />
      {children}
    </Panel>
  );
}

export function PanelHeader({
  icon,
  title,
  subtitle,
  large,
  accessory,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string | null;
  large?: boolean;
  accessory?: ReactNode;
}) {
  const theme = useTheme();
  const iconSize = large ? PANEL.largeIcon : PANEL.iconSlot;
  const titleLine = large ? PANEL.titleLine + 1 : PANEL.titleLine;
  const [textHeight, setTextHeight] = useState(titleLine + (subtitle ? PANEL.subtitleLine : 0));
  const overhang = Math.max(0, (textHeight - iconSize) / 2);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: PANEL.iconGap,
        paddingHorizontal: PANEL.inset,
        paddingTop: PANEL.inset - overhang,
        paddingBottom: PANEL.headerGap,
      }}
    >
      <View style={{ width: iconSize, height: iconSize, alignItems: "center", justifyContent: "center" }}>{icon}</View>
      <View style={{ flex: 1 }} onLayout={(e) => setTextHeight(e.nativeEvent.layout.height)}>
        <Text numberOfLines={1} style={{ fontSize: large ? typeScale.title.fontSize : PANEL.titleSize, lineHeight: titleLine, fontWeight: weight.semibold, color: theme.textPrimary }}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={large ? 2 : 1} style={{ fontSize: PANEL.subtitleSize, lineHeight: PANEL.subtitleLine, color: theme.textSecondary }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {accessory}
    </View>
  );
}

const VALUE_PAD = space.s;

export function PopoverValue({ title, onPress, chevron = "chevron.up.chevron.down", tooltip }: { title: string; onPress: () => void; chevron?: string; tooltip?: string }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} tooltip={tooltip} style={{ marginRight: -VALUE_PAD }}>
      <Pressable onPress={onPress}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, height: 22, paddingLeft: space.m, paddingRight: VALUE_PAD, borderRadius: radius.control, backgroundColor: hovered ? theme.toolbarHover : undefined }}>
          <Text style={{ fontSize: PANEL.valueSize, color: theme.textSecondary }}>{title}</Text>
          <Symbol name={chevron} size={9} weight={chevron === "chevron.down" ? "semibold" : undefined} color={theme.textSecondary} style={{ width: 8, height: 14 }} />
        </View>
      </Pressable>
    </View>
  );
}

const PANEL_CLOSE_OFFSET = PANEL.inset - (PANEL_CLOSE_SIZE - PANEL_CLOSE_GLYPH) / 2;
const PANEL_CLOSE_PLACE = { position: "absolute", top: PANEL_CLOSE_OFFSET, right: PANEL_CLOSE_OFFSET } as const;

export function PanelCloseButton({ onPress, tooltip = "Dismiss" }: { onPress: () => void; tooltip?: string }) {
  return <Button variant="close" look="panel" onPress={onPress} tooltip={tooltip} style={PANEL_CLOSE_PLACE} />;
}
