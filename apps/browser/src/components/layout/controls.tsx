import { ContextMenuArea, Surface, Symbol, VisualEffect, type SurfaceProps, type SymbolProps } from "@ardia/shell";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent, type ViewStyle } from "react-native";
import { hex, useTheme } from "../../lib/theme";
import { Switch, switchEasing } from "../Switch";
import { useHover } from "../primitives";
import type { ToolbarPalette } from "./toolbarColors";

export type ClickModifiers = { metaKey: boolean; altKey: boolean; shiftKey: boolean };
export function modifiersOf(e: GestureResponderEvent | undefined): ClickModifiers {
  const n = (e?.nativeEvent ?? {}) as Partial<ClickModifiers>;
  return { metaKey: !!n.metaKey, altKey: !!n.altKey, shiftKey: !!n.shiftKey };
}

export function ToolbarButton({
  icon,
  onPress,
  onLongPress,
  onContextMenu,
  disabled,
  active,
  size = 15,
  box = 30,
  radius = 7,
  weight = "regular",
  tooltip,
  palette,
  color,
  style,
  hit,
}: {
  icon: string;
  onPress?: (modifiers: ClickModifiers) => void;
  onLongPress?: () => void;
  onContextMenu?: () => void;
  disabled?: boolean;
  active?: boolean;
  size?: number;
  box?: number;
  radius?: number;
  weight?: SymbolProps["weight"];
  tooltip?: string;
  palette: Pick<ToolbarPalette, "icon" | "iconDisabled" | "hover" | "pressed">;
  color?: string;
  style?: ViewStyle;
  hit?: ButtonHit;
}) {
  const { hovered, hoverProps } = useHover();
  const plate = (pressed: boolean) => (
    <View
      style={{
        position: hit ? "absolute" : "relative",
        left: hit?.plateX,
        top: hit?.plateY,
        width: hit?.box ?? box,
        height: hit?.box ?? box,
        borderRadius: hit?.radius ?? radius,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: disabled ? undefined : pressed || active ? palette.pressed : hovered ? palette.hover : undefined,
      }}
    >
      <Symbol name={icon} size={size} weight={weight} color={color ?? (disabled ? palette.iconDisabled : palette.icon)} style={{ width: hit?.box ?? box, height: hit?.box ?? box }} />
    </View>
  );
  const button = (
    <Pressable
      onPress={(e) => onPress?.(modifiersOf(e))}
      onLongPress={onLongPress}
      delayLongPress={450}
      disabled={disabled}
      accessibilityLabel={tooltip}
      style={hit ? { width: hit.width, height: hit.height } : undefined}
    >
      {({ pressed }) => plate(pressed)}
    </Pressable>
  );
  return (
    <View tooltip={tooltip} style={style} mouseDownCanMoveWindow={false} {...hoverProps}>
      {onContextMenu && !disabled ? <ContextMenuArea onContextMenu={onContextMenu}>{button}</ContextMenuArea> : button}
    </View>
  );
}

export type ButtonHit = { width: number; height: number; plateX: number; plateY: number; box?: number; radius?: number };

export const POPOVER_MARGIN = 8;

const INSET = 16;
const ROW_INSET = 6;
const RADIUS = 12;
const ROW_HEIGHT = 32;
const ICON_SLOT = 20;
const ICON_GAP = 10;
export const PANEL = {
  radius: RADIUS,
  inset: INSET,
  rowInset: ROW_INSET,
  rowPadding: INSET - ROW_INSET,
  rowRadius: RADIUS - ROW_INSET,
  rowHeight: ROW_HEIGHT,
  iconSlot: ICON_SLOT,
  iconSize: 13,
  iconGap: ICON_GAP,
  textColumn: INSET + ICON_SLOT + ICON_GAP,
  listPadding: INSET - (ROW_HEIGHT - ICON_SLOT) / 2,
  headerGap: 8,
  separatorGap: 5,
  titleSize: 13,
  titleLine: 16,
  subtitleSize: 11,
  subtitleLine: 14,
  valueSize: 12,
} as const;

export function PanelHeader({
  icon,
  iconSize = PANEL.iconSlot,
  title,
  subtitle,
  subtitleLines = 1,
  large,
  accessory,
}: {
  icon: ReactNode;
  iconSize?: number;
  title: string;
  subtitle?: string | null;
  subtitleLines?: number;
  large?: boolean;
  accessory?: ReactNode;
}) {
  const theme = useTheme();
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
        <Text numberOfLines={1} style={{ fontSize: large ? 14 : PANEL.titleSize, lineHeight: titleLine, fontWeight: "600", color: theme.textPrimary }}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={subtitleLines} style={{ fontSize: large ? 11.5 : PANEL.subtitleSize, lineHeight: PANEL.subtitleLine, color: theme.textSecondary }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {accessory}
    </View>
  );
}

export function PopoverValue({ title, onPress, chevron = "chevron.up.chevron.down", tooltip }: { title: string; onPress: () => void; chevron?: string; tooltip?: string }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} tooltip={tooltip} style={{ marginRight: -VALUE_PAD }}>
      <Pressable onPress={onPress}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3, height: 22, paddingLeft: 8, paddingRight: VALUE_PAD, borderRadius: 6, backgroundColor: hovered ? theme.toolbarHover : undefined }}>
          <Text style={{ fontSize: PANEL.valueSize, color: theme.textSecondary }}>{title}</Text>
          <Symbol name={chevron} size={9} weight={chevron === "chevron.down" ? "semibold" : undefined} color={theme.textSecondary} style={{ width: 8, height: 14 }} />
        </View>
      </Pressable>
    </View>
  );
}
const VALUE_PAD = 6;

export function PanelCloseButton({ onPress, tooltip = "Dismiss" }: { onPress: () => void; tooltip?: string }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const offset = PANEL.inset - (CLOSE_BOX - CLOSE_GLYPH) / 2;
  return (
    <View {...hoverProps} style={{ position: "absolute", top: offset, right: offset }} tooltip={tooltip}>
      <Pressable onPress={onPress}>
        <View style={{ width: CLOSE_BOX, height: CLOSE_BOX, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: hovered ? theme.toolbarHover : undefined }}>
          <Symbol name="xmark" size={9} weight="semibold" color={theme.textSecondary} style={{ width: 14, height: 14 }} />
        </View>
      </Pressable>
    </View>
  );
}
const CLOSE_BOX = 22;
const CLOSE_GLYPH = 7;

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
}: {
  width: number;
  top: number;
  right?: number;
  left?: number;
  onDismiss?: () => void;
  children: ReactNode;
  modal?: boolean;
  fitHeight?: boolean;
  closing?: boolean;
  onClosed?: () => void;
}) {
  const appear = useRef(new Animated.Value(0)).current;
  const [room, setRoom] = useState<number | null>(null);
  const closed = useRef(onClosed);
  closed.current = onClosed;
  useEffect(() => {
    const motion = closing ? POPOVER_MOTION.close : POPOVER_MOTION.open;
    Animated.timing(appear, { toValue: closing ? 0 : 1, duration: motion.duration, easing: motion.easing, useNativeDriver: true }).start(
      ({ finished }) => finished && closing && closed.current?.(),
    );
  }, [closing]);
  const origin = right !== undefined ? "top right" : "top left";
  return (
    <>
      {fitHeight && <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e) => setRoom(e.nativeEvent.layout.height)} />}
      {modal && onDismiss && !closing && <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />}
      <Animated.View
        pointerEvents={closing ? "none" : "auto"}
        style={{
          position: "absolute",
          top,
          right,
          left,
          width,
          opacity: appear,
          transformOrigin: origin,
          transform: [
            { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
            { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) },
          ],
        }}
      >
        <PopoverSurface>
          {fitHeight ? <ScrollView showsVerticalScrollIndicator={false} style={room === null ? undefined : { maxHeight: Math.max(0, room - top - POPOVER_MARGIN) }}>{children}</ScrollView> : children}
        </PopoverSurface>
      </Animated.View>
    </>
  );
}

export function PopoverSurface({ children, ...props }: SurfaceProps) {
  const theme = useTheme();
  return (
    <Surface
      {...props}
      fill={hex(theme.dark ? "rgba(38,36,37,0.94)" : "rgba(252,251,252,0.96)")}
      cornerRadius={PANEL.radius}
      borderColor={hex(theme.dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)")}
      borderWidth={0.5}
      shadowColor="#000000"
      shadowOpacity={theme.dark ? 0.45 : 0.16}
      shadowRadius={18}
      shadowOffset={[0, 8]}
    >
      <VisualEffect material="menu" cornerRadius={PANEL.radius} style={StyleSheet.absoluteFill} />
      <View style={{ ...StyleSheet.absoluteFillObject, borderRadius: PANEL.radius, backgroundColor: theme.dark ? "rgba(38,36,37,0.72)" : "rgba(252,251,252,0.7)" }} />
      {children}
    </Surface>
  );
}

export const popoverRowFill = (dark: boolean, pressed = false) => (dark ? `rgba(255,255,255,${pressed ? 0.12 : 0.07})` : `rgba(0,0,0,${pressed ? 0.1 : 0.06})`);

export const POPOVER_MOTION = {
  open: { duration: 150, easing: Easing.out(Easing.cubic) },
  close: { duration: 100, easing: Easing.in(Easing.quad) },
} as const;

export function usePopoverPresence(open: boolean) {
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  return { shown: open || shown, closing: !open, onClosed: () => setShown(false) };
}

export function PopoverRow({
  icon,
  leading,
  iconColor,
  title,
  detail,
  accessory,
  onPress,
  disabled,
  destructive,
}: {
  icon?: string;
  leading?: ReactNode;
  iconColor?: string;
  title: string;
  detail?: string;
  accessory?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const tint = destructive ? "#FF6B63" : theme.textPrimary;
  const content = (pressed: boolean) => (
    <View
      style={{
        minHeight: PANEL.rowHeight,
        marginHorizontal: PANEL.rowInset,
        paddingHorizontal: PANEL.rowPadding,
        borderRadius: PANEL.rowRadius,
        flexDirection: "row",
        alignItems: "center",
        gap: PANEL.iconGap,
        opacity: disabled ? 0.45 : 1,
        backgroundColor: onPress && !disabled && (pressed || hovered) ? popoverRowFill(theme.dark, pressed) : undefined,
      }}
    >
      {leading ? (
        <View style={{ width: PANEL.iconSlot, height: PANEL.iconSlot, alignItems: "center", justifyContent: "center" }}>{leading}</View>
      ) : icon ? (
        <Symbol name={icon} size={PANEL.iconSize} color={iconColor ?? (destructive ? tint : theme.icon)} style={{ width: PANEL.iconSlot, height: PANEL.iconSlot }} />
      ) : null}
      <View style={{ flex: 1, paddingVertical: 6 }}>
        <Text numberOfLines={1} style={{ fontSize: PANEL.titleSize, color: tint }}>
          {title}
        </Text>
        {detail ? (
          <Text numberOfLines={2} style={{ fontSize: PANEL.subtitleSize, color: theme.textSecondary, marginTop: 1 }}>
            {detail}
          </Text>
        ) : null}
      </View>
      {accessory}
    </View>
  );
  if (!onPress) return <View {...hoverProps}>{content(false)}</View>;
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress} disabled={disabled}>
        {({ pressed }) => content(pressed)}
      </Pressable>
    </View>
  );
}

export function PopoverSeparator() {
  const theme = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, marginVertical: PANEL.separatorGap, marginHorizontal: PANEL.inset, backgroundColor: theme.dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)" }} />;
}

export function PromptButton({ title, onPress, primary, flex }: { title: string; onPress: () => void; primary?: boolean; flex?: boolean }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} style={flex ? { flex: 1 } : undefined}>
      <Pressable onPress={onPress}>
        {({ pressed }) => (
          <View
            style={{
              height: 28,
              paddingHorizontal: 12,
              borderRadius: 8,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: primary
                ? theme.dark
                  ? pressed ? "#C9B8C5" : hovered ? "#E6D8E2" : theme.goButton
                  : pressed ? "#26314A" : hovered ? "#1B2640" : theme.goButton
                : theme.dark
                  ? `rgba(255,255,255,${pressed ? 0.18 : hovered ? 0.14 : 0.1})`
                  : `rgba(0,0,0,${pressed ? 0.12 : hovered ? 0.09 : 0.06})`,
            }}
          >
            <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "500", color: primary ? theme.goButtonText : theme.textPrimary }}>
              {title}
            </Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  const theme = useTheme();
  return (
    <Switch
      value={value}
      onChange={onChange}
      look={{ width: 30, height: 17, knob: 14, inset: 1.5, offColor: theme.dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.12)", onColor: "#3478F6", duration: 150, easing: switchEasing.quadOut }}
    />
  );
}
