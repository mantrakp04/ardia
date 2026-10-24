import { ContextMenuArea, Symbol } from "@ardia/shell";
import { Children, forwardRef, type ReactNode } from "react";
import { Image, Pressable, Text, View, type AccessibilityActionEvent, type GestureResponderEvent } from "react-native";
import { useTheme, type Theme } from "../../lib/theme";
import { PANEL } from "../layout/controls";
import { useHover } from "../primitives";

export const SITE_PANEL = {
  width: 288,
  gap: 8,
  actionHeight: 40,
  extensionHeight: 36,
  tileRadius: 8,
  sectionTop: 14,
  sectionGap: 8,
  settingHeight: 42,
  settingBadge: 26,
  footerControl: 26,
} as const;

export function tileFill(theme: Theme, pressed: boolean, hovered: boolean) {
  const alpha = pressed ? 0.16 : hovered ? 0.11 : 0.07;
  return theme.dark ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha * 0.75})`;
}

export const tileStroke = (theme: Theme) => (theme.dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)");

export function SectionTitle({ title, tight }: { title: string; tight?: boolean }) {
  const theme = useTheme();
  return (
    <Text
      style={{
        marginTop: SITE_PANEL.sectionTop,
        marginBottom: tight ? SITE_PANEL.sectionGap - (SITE_PANEL.settingHeight - SITE_PANEL.settingBadge) / 2 : SITE_PANEL.sectionGap,
        marginHorizontal: PANEL.inset,
        fontSize: 12,
        lineHeight: 15,
        fontWeight: "600",
        color: theme.textSecondary,
      }}
    >
      {title}
    </Text>
  );
}

export function gridColumns(actionCount: number) {
  return actionCount === 3 ? 3 : 4;
}

export function TileGrid({ columns, children }: { columns: number; children: ReactNode }) {
  const cells = Children.toArray(children);
  const rows = Array.from({ length: Math.ceil(cells.length / columns) }, (_, row) => cells.slice(row * columns, row * columns + columns));
  return (
    <View style={{ gap: SITE_PANEL.gap, paddingHorizontal: PANEL.inset }}>
      {rows.map((row, index) => (
        <View key={index} style={{ flexDirection: "row", gap: SITE_PANEL.gap }}>
          {row}
          {Array.from({ length: columns - row.length }, (_, spacer) => (
            <View key={`spacer${spacer}`} style={{ flex: 1 }} />
          ))}
        </View>
      ))}
    </View>
  );
}

export function TileRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", gap: SITE_PANEL.gap, paddingHorizontal: PANEL.inset }}>{children}</View>;
}

const ACTIVATE = [{ name: "activate" }];

export const ActionTile = forwardRef<View, { icon: string; label: string; active?: boolean; onPress: (press: GestureResponderEvent | AccessibilityActionEvent) => void }>(function ActionTile(
  { icon, label, active, onPress },
  ref,
) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View ref={ref} collapsable={false} tooltip={label} accessibilityLabel={label} style={{ flex: 1 }} {...hoverProps}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityActions={ACTIVATE}
        onAccessibilityAction={(event) => event.nativeEvent.actionName === "activate" && onPress(event)}
      >
        {({ pressed }) => (
          <View
            style={{
              height: SITE_PANEL.actionHeight,
              borderRadius: SITE_PANEL.tileRadius,
              borderWidth: 0.5,
              borderColor: tileStroke(theme),
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: tileFill(theme, pressed, hovered),
            }}
          >
            <Symbol name={icon} size={15} color={active ? theme.accent : theme.icon} style={{ width: 22, height: 22 }} />
          </View>
        )}
      </Pressable>
    </View>
  );
});

export const ExtensionTile = forwardRef<
  View,
  { name: string; icon: string | null; symbol?: string; dimmed?: boolean; onPress: () => void; onContextMenu?: () => void }
>(function ExtensionTile({ name, icon, symbol = "puzzlepiece.extension", dimmed, onPress, onContextMenu }, ref) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const button = (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={name}>
      {({ pressed }) => (
        <View
          style={{
            height: SITE_PANEL.extensionHeight,
            borderRadius: SITE_PANEL.tileRadius,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: tileFill(theme, pressed, hovered),
          }}
        >
          {icon ? (
            <View pointerEvents="none">
              <Image source={{ uri: icon }} style={{ width: 18, height: 18, opacity: dimmed ? 0.45 : 1 }} />
            </View>
          ) : (
            <Symbol name={symbol} size={14} color={theme.icon} style={{ width: 20, height: 20 }} />
          )}
        </View>
      )}
    </Pressable>
  );
  return (
    <View ref={ref} collapsable={false} tooltip={name} style={{ flex: 1 }} {...hoverProps}>
      {onContextMenu ? <ContextMenuArea onContextMenu={onContextMenu}>{button}</ContextMenuArea> : button}
    </View>
  );
});

export function SettingRow({
  icon,
  title,
  value,
  on,
  onPress,
}: {
  icon: string;
  title: string;
  value: string;
  on: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const content = (pressed: boolean) => (
    <View
      style={{
        height: SITE_PANEL.settingHeight,
        marginHorizontal: PANEL.rowInset,
        paddingHorizontal: PANEL.rowPadding,
        borderRadius: PANEL.rowRadius,
        flexDirection: "row",
        alignItems: "center",
        gap: PANEL.iconGap,
        backgroundColor: onPress && (pressed || hovered) ? (theme.dark ? `rgba(255,255,255,${pressed ? 0.12 : 0.07})` : `rgba(0,0,0,${pressed ? 0.1 : 0.06})`) : undefined,
      }}
    >
      <View
        style={{
          width: SITE_PANEL.settingBadge,
          height: SITE_PANEL.settingBadge,
          borderRadius: SITE_PANEL.settingBadge / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: on ? theme.accent : tileFill(theme, false, true),
        }}
      >
        <Symbol name={icon} size={12} weight="medium" color={on ? "#FFFFFF" : theme.icon} style={{ width: 18, height: 18 }} />
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontSize: PANEL.titleSize, lineHeight: PANEL.titleLine, fontWeight: "500", color: theme.textPrimary }}>
          {title}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: PANEL.subtitleSize, lineHeight: PANEL.subtitleLine, color: theme.textSecondary }}>
          {value}
        </Text>
      </View>
    </View>
  );
  if (!onPress) return <View {...hoverProps}>{content(false)}</View>;
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}: ${value}`}>
        {({ pressed }) => content(pressed)}
      </Pressable>
    </View>
  );
}

export function FooterChip({ icon, title, color, open, onPress }: { icon: string; title: string; color?: string; open: boolean; onPress?: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} tooltip={onPress ? (open ? "Hide Connection Details" : "Connection Details") : undefined}>
      <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityLabel={title}>
        {({ pressed }) => (
          <View
            style={{
              height: SITE_PANEL.footerControl,
              paddingLeft: 7,
              paddingRight: 9,
              borderRadius: 7,
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              backgroundColor: tileFill(theme, pressed || open, !!onPress && hovered),
            }}
          >
            <Symbol name={icon} size={11} weight="medium" color={color ?? theme.icon} style={{ width: 14, height: 16 }} />
            <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "500", color: color ?? theme.textPrimary }}>
              {title}
            </Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

export function MoreButton({ open, onPress }: { open: boolean; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const label = open ? "Fewer Site Controls" : "More Site Controls";
  return (
    <View {...hoverProps} tooltip={label}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
        {({ pressed }) => (
          <View
            style={{
              width: SITE_PANEL.footerControl,
              height: SITE_PANEL.footerControl,
              borderRadius: SITE_PANEL.footerControl / 2,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: tileFill(theme, pressed || open, hovered),
            }}
          >
            <Symbol name="ellipsis" size={12} weight="semibold" color={theme.icon} style={{ width: 18, height: 18 }} />
          </View>
        )}
      </Pressable>
    </View>
  );
}
