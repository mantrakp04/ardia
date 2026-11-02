import { Children, forwardRef, type ReactNode } from "react";
import { Image, Pressable, View, type AccessibilityActionEvent, type GestureResponderEvent, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../ui/theme";
import { capsule, ContextMenuArea, Dot, GlassFill, hairline, menuRowFill, opacity, PANEL, radius, space, Symbol, Text, useGlass, useHover } from "../ui";
import { useSiteTokens } from "./tokens";

export const SITE_PANEL = {
  width: 288,
  gap: space.m,
  actionHeight: 40,
  captionHeight: 44,
  extensionHeight: 36,
  sectionTop: space.xl,
  sectionGap: space.m,
  settingHeight: 42,
  settingBadge: 26,
  footerControl: 26,
} as const;

export type TileShape = "tile" | "row" | "capsule";

export function Tile({
  shape,
  height,
  hovered,
  pressed,
  open = false,
  quiet = false,
  stroke = false,
  style,
  children,
}: {
  shape: TileShape;
  height: number;
  hovered: boolean;
  pressed: boolean;
  open?: boolean;
  quiet?: boolean;
  stroke?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const theme = useTheme();
  const site = useSiteTokens();
  const glass = useGlass();
  const lit = pressed || open;
  const fill = shape === "row" || quiet ? (lit || hovered ? menuRowFill(theme, lit) : undefined) : lit ? site.tilePressed : hovered ? site.tileHover : site.tile;
  const corner = shape === "tile" ? radius.tile : shape === "row" ? PANEL.rowRadius : capsule(height);
  return (
    <View
      style={[
        { height, borderRadius: corner, backgroundColor: glass ? undefined : fill, borderWidth: stroke && !glass ? hairline.ring : 0, borderColor: stroke ? site.tileStroke : undefined },
        style,
      ]}
    >
      {glass && fill ? <GlassFill radius={corner} state={lit ? "pressed" : hovered ? "lit" : "rest"} /> : null}
      {children}
    </View>
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
const CENTERED = { alignItems: "center", justifyContent: "center" } as const;
const CAPTIONED = { alignItems: "center", justifyContent: "center", gap: space.xs } as const;

export const ActionTile = forwardRef<
  View,
  { icon: string; label: string; active?: boolean; caption?: boolean; onPress: (press: GestureResponderEvent | AccessibilityActionEvent) => void }
>(function ActionTile({ icon, label, active, caption = false, onPress }, ref) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View ref={ref} collapsable={false} tooltip={caption ? undefined : label} accessibilityLabel={label} style={{ flex: 1 }} {...hoverProps}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityActions={ACTIVATE}
        onAccessibilityAction={(event) => event.nativeEvent.actionName === "activate" && onPress(event)}
      >
        {({ pressed }) => (
          <Tile shape="tile" height={caption ? SITE_PANEL.captionHeight : SITE_PANEL.actionHeight} hovered={hovered} pressed={pressed} stroke style={caption ? CAPTIONED : CENTERED}>
            {caption ? (
              <>
                <Symbol name={icon} size={13} color={active ? theme.accent : theme.icon} style={CAPTION_GLYPH} />
                <Text size="tiny" tone="textSecondary">
                  {label}
                </Text>
              </>
            ) : (
              <Symbol name={icon} size={15} color={active ? theme.accent : theme.icon} style={ACTION_GLYPH} />
            )}
          </Tile>
        )}
      </Pressable>
    </View>
  );
});

const ACTION_GLYPH = { width: 22, height: 22 } as const;
const CAPTION_GLYPH = { width: 18, height: 16 } as const;

export const ExtensionTile = forwardRef<
  View,
  { name: string; icon: string | null; symbol?: string; dimmed?: boolean; onPress: () => void; onContextMenu?: () => void }
>(function ExtensionTile({ name, icon, symbol = "puzzlepiece.extension", dimmed, onPress, onContextMenu }, ref) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const button = (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={name}>
      {({ pressed }) => (
        <Tile shape="tile" height={SITE_PANEL.extensionHeight} hovered={hovered} pressed={pressed} style={CENTERED}>
          {icon ? (
            <View pointerEvents="none">
              <Image source={{ uri: icon }} style={{ width: 18, height: 18, opacity: dimmed ? opacity.disabled : 1 }} />
            </View>
          ) : (
            <Symbol name={symbol} size={14} color={theme.icon} style={{ width: 20, height: 20 }} />
          )}
        </Tile>
      )}
    </Pressable>
  );
  return (
    <View ref={ref} collapsable={false} tooltip={name} style={{ flex: 1 }} {...hoverProps}>
      {onContextMenu ? <ContextMenuArea onContextMenu={onContextMenu}>{button}</ContextMenuArea> : button}
    </View>
  );
});

const SETTING_ROW = { marginHorizontal: PANEL.rowInset, paddingHorizontal: PANEL.rowPadding, flexDirection: "row", alignItems: "center", gap: PANEL.iconGap } as const;

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
  const site = useSiteTokens();
  const { hovered, hoverProps } = useHover();
  const content = (pressed: boolean) => (
    <Tile shape="row" height={SITE_PANEL.settingHeight} hovered={!!onPress && hovered} pressed={!!onPress && pressed} style={SETTING_ROW}>
      <Dot size={SITE_PANEL.settingBadge} color={on ? theme.accent : site.tileHover}>
        <Symbol name={icon} size={12} weight="medium" color={on ? theme.onAccent : theme.icon} style={{ width: 18, height: 18 }} />
      </Dot>
      <View style={{ flex: 1 }}>
        <Text lines={1} weight="medium" style={{ fontSize: PANEL.titleSize, lineHeight: PANEL.titleLine }}>
          {title}
        </Text>
        <Text lines={1} tone="textSecondary" style={{ fontSize: PANEL.subtitleSize, lineHeight: PANEL.subtitleLine }}>
          {value}
        </Text>
      </View>
    </Tile>
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

export function ChipButton({
  icon,
  title,
  color,
  open = false,
  quiet = false,
  tooltip,
  label,
  onPress,
}: {
  icon: string;
  title: string;
  color?: string;
  open?: boolean;
  quiet?: boolean;
  tooltip?: string;
  label?: string;
  onPress?: (press: GestureResponderEvent) => void;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} tooltip={tooltip}>
      <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityLabel={label ?? title}>
        {({ pressed }) => (
          <Tile shape="tile" quiet={quiet} height={SITE_PANEL.footerControl} hovered={!!onPress && hovered} pressed={pressed} open={open} style={CHIP}>
            <Symbol name={icon} size={quiet ? 12 : 11} weight="medium" color={color ?? theme.icon} style={quiet ? QUIET_GLYPH : CHIP_GLYPH} />
            <Text lines={1} size={quiet ? "body" : "small"} weight="medium" color={color}>
              {title}
            </Text>
          </Tile>
        )}
      </Pressable>
    </View>
  );
}

const CHIP = { paddingHorizontal: space.m, flexDirection: "row", alignItems: "center", gap: space.xs } as const;
const CHIP_GLYPH = { width: 14, height: 16 } as const;
const QUIET_GLYPH = { width: 16, height: 16 } as const;

export function MoreButton({ open, onPress }: { open: boolean; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const label = open ? "Fewer Site Controls" : "More Site Controls";
  return (
    <View {...hoverProps} tooltip={label}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
        {({ pressed }) => (
          <Tile shape="capsule" height={SITE_PANEL.footerControl} hovered={hovered} pressed={pressed} open={open} style={MORE}>
            <Symbol name="ellipsis" size={12} weight="semibold" color={theme.icon} style={{ width: 18, height: 18 }} />
          </Tile>
        )}
      </Pressable>
    </View>
  );
}

const MORE = { width: SITE_PANEL.footerControl, alignItems: "center", justifyContent: "center" } as const;
