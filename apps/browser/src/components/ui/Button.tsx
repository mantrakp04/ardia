import { ContextMenuArea, Surface, Symbol, VisualEffect, type SymbolProps } from "@ardia/shell";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { modifiersOf, type ClickModifiers } from "../../lib/keys";
import { useHover } from "./useHover";
import { hex, useTheme, type Theme } from "./theme";
import { closeOnArt, opacity, radius as radii, space, font as typeScale, weight as weights, type ColorRole, type Space, type TypeSize, type Weight } from "./tokens";

export type ButtonHit = { width: number; height: number; plateX: number; plateY: number; box?: number; radius?: number };

export type IconPalette = { icon: string; iconDisabled: string; hover: string; pressed: string };

type IconProps = {
  variant: "icon";
  icon: string;
  onPress?: (modifiers: ClickModifiers) => void;
  onLongPress?: () => void;
  onContextMenu?: () => void;
  disabled?: boolean;
  active?: boolean;
  size?: number;
  box?: number;
  glyphBox?: number;
  radius?: number;
  weight?: SymbolProps["weight"];
  tooltip?: string;
  palette?: IconPalette;
  color?: string;
  style?: ViewStyle;
  hit?: ButtonHit;
  toolbar?: boolean;
};

type TextProps = {
  variant: "text";
  title: string;
  onPress: () => void;
  disabled?: boolean;
  plate?: "toolbar" | "hover" | "none";
  height?: number;
  pad?: Space;
  padY?: Space;
  size?: TypeSize;
  weight?: Weight;
  tone?: ColorRole;
  hoverTone?: ColorRole;
  label?: string;
};

type PillProps = {
  variant: "pill";
  onPress: () => void;
  title?: string;
  icon?: string;
  tone?: "prompt" | "chip" | "control";
  primary?: boolean;
  disabled?: boolean;
  flex?: boolean;
  height?: number;
  width?: number;
  tooltip?: string;
};

type CloseProps = {
  variant: "close";
  onPress: () => void;
  look: "hud" | "panel" | "art";
  tooltip?: string;
  label?: string;
  box?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

type PushProps = {
  variant?: "push";
  title: string;
  onPress: () => void;
  kind?: "default" | "primary" | "destructive" | "plain";
  disabled?: boolean;
  icon?: string;
  style?: StyleProp<ViewStyle>;
};

export type ButtonProps = IconProps | TextProps | PillProps | CloseProps | PushProps;

export const Button = memo(function Button(props: ButtonProps) {
  switch (props.variant) {
    case "icon":
      return <IconButtonView {...props} />;
    case "text":
      return <TextButtonView {...props} />;
    case "pill":
      return <PillButtonView {...props} />;
    case "close":
      return <CloseButtonView {...props} />;
    default:
      return <PushButtonView {...props} />;
  }
});

function IconButtonView({ icon, onPress, onLongPress, onContextMenu, disabled, active, size = 15, box = 30, glyphBox, radius = 7, weight = "regular", tooltip, palette, color, style, hit, toolbar }: IconProps) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const hover = palette ? palette.hover : theme.toolbarHover;
  const pressedFill = palette ? palette.pressed : theme.toolbarPressed;
  const plateBox = hit?.box ?? box;
  const plate = (pressed: boolean) => (
    <View
      style={{
        position: hit ? "absolute" : "relative",
        left: hit?.plateX,
        top: hit?.plateY,
        width: plateBox,
        height: plateBox,
        borderRadius: hit?.radius ?? radius,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: disabled ? undefined : pressed || active ? pressedFill : hovered ? hover : undefined,
      }}
    >
      <Symbol
        name={icon}
        size={size}
        weight={weight}
        color={color ?? (disabled ? (palette ? palette.iconDisabled : theme.iconDisabled) : palette ? palette.icon : theme.icon)}
        style={{ width: glyphBox ?? plateBox, height: glyphBox ?? plateBox }}
      />
    </View>
  );
  if (!toolbar)
    return (
      <View tooltip={tooltip} style={style} {...hoverProps}>
        <Pressable onPress={onPress as (() => void) | undefined} disabled={disabled}>
          {({ pressed }) => plate(pressed)}
        </Pressable>
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

function TextButtonView({ title, onPress, disabled, plate = "toolbar", height, pad = "m", padY, size = "small", weight = "medium", tone = "textPrimary", hoverTone, label }: TextProps) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const a11y = label ? ({ accessibilityRole: "button", accessibilityLabel: label } as const) : undefined;
  const textStyle = (color: string) => ({ ...typeScale[size], ...(weight === "regular" ? null : { fontWeight: weights[weight] }), color });
  if (plate === "none")
    return (
      <View {...hoverProps}>
        <Pressable onPress={onPress} disabled={disabled} {...a11y}>
          <Text style={{ ...textStyle(hovered && hoverTone ? theme[hoverTone] : theme[tone]), paddingVertical: padY ? space[padY] : undefined }}>{title}</Text>
        </Pressable>
      </View>
    );
  const fill = (pressed: boolean) =>
    disabled ? undefined : plate === "toolbar" && pressed ? theme.toolbarPressed : hovered ? theme.toolbarHover : undefined;
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress} disabled={disabled} {...a11y}>
        {({ pressed }) => (
          <View style={{ height, paddingHorizontal: space[pad], borderRadius: radii.m, justifyContent: "center", backgroundColor: fill(pressed) }}>
            <Text style={textStyle(disabled ? theme.iconDisabled : theme[tone])}>{title}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

function pillLook(theme: Theme, tone: NonNullable<PillProps["tone"]>, primary: boolean, pressed: boolean, hovered: boolean) {
  if (tone === "chip")
    return primary
      ? { fill: theme.textPrimary, text: theme.onPrimary, dim: pressed || hovered }
      : { fill: pressed ? theme.toolbarPressed : hovered ? theme.toolbarHover : theme.urlPill, text: theme.textPrimary, dim: false };
  if (tone === "control") return { fill: pressed ? theme.controlPressed : hovered ? theme.controlHover : theme.control, text: theme.icon, dim: false };
  return primary
    ? { fill: pressed ? theme.goButtonPressed : hovered ? theme.goButtonHover : theme.goButton, text: theme.onPrimary, dim: false }
    : { fill: pressed ? theme.promptFillPressed : hovered ? theme.promptFillHover : theme.promptFill, text: theme.textPrimary, dim: false };
}

function PillButtonView({ onPress, title, icon, tone = "prompt", primary = false, disabled, flex, height, width, tooltip }: PillProps) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  if (tone === "control")
    return (
      <View {...hoverProps} style={{ opacity: disabled ? CONTROL_DISABLED_OPACITY : 1 }}>
        <Pressable disabled={disabled} onPress={onPress} tooltip={tooltip}>
          {({ pressed }) => (
            <View
              style={{
                width,
                height,
                borderRadius: radii.field,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pillLook(theme, tone, false, pressed, hovered).fill,
                borderWidth: StyleSheet.hairlineWidth * 2,
                borderColor: theme.controlBorder,
              }}
            >
              {icon ? <Symbol name={icon} size={10} weight="semibold" color={theme.icon} style={{ width: 12, height: 12 }} /> : null}
            </View>
          )}
        </Pressable>
      </View>
    );
  if (tone === "chip") {
    const chipHeight = height ?? 24;
    return (
      <View {...hoverProps}>
        <Pressable onPress={onPress}>
          {({ pressed }) => {
            const look = pillLook(theme, tone, primary, pressed, hovered);
            const ink = look.text;
            return (
              <View
                style={{
                  height: chipHeight,
                  borderRadius: chipHeight > 26 ? 9 : 7,
                  paddingHorizontal: 9,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 5,
                  backgroundColor: look.fill,
                  opacity: look.dim ? 0.85 : 1,
                }}
              >
                {icon ? <Symbol name={icon} size={10.5} weight="semibold" color={ink} style={{ width: 14, height: 14 }} /> : null}
                <Text style={{ ...typeScale.small, fontWeight: weights.medium, color: ink }}>{title}</Text>
              </View>
            );
          }}
        </Pressable>
      </View>
    );
  }
  return (
    <View {...hoverProps} style={flex ? FLEX : undefined}>
      <Pressable onPress={onPress}>
        {({ pressed }) => {
          const look = pillLook(theme, tone, primary, pressed, hovered);
          return (
            <View style={{ height: height ?? 28, paddingHorizontal: space.l, borderRadius: radii.l, alignItems: "center", justifyContent: "center", backgroundColor: look.fill }}>
              <Text numberOfLines={1} style={{ ...typeScale.body, fontWeight: weights.medium, color: look.text }}>
                {title}
              </Text>
            </View>
          );
        }}
      </Pressable>
    </View>
  );
}

const FLEX = { flex: 1 } as const;
const CONTROL_DISABLED_OPACITY = 0.4;

function CloseButtonView({ onPress, look, tooltip = "Dismiss", label, box, radius, style }: CloseProps) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  if (look === "panel")
    return (
      <View {...hoverProps} style={style} tooltip={tooltip}>
        <Pressable onPress={onPress}>
          <View style={{ width: PANEL_CLOSE_BOX, height: PANEL_CLOSE_BOX, borderRadius: radii.m, alignItems: "center", justifyContent: "center", backgroundColor: hovered ? theme.toolbarHover : undefined }}>
            <Symbol name="xmark" size={9} weight="semibold" color={theme.textSecondary} style={{ width: 14, height: 14 }} />
          </View>
        </Pressable>
      </View>
    );
  if (look === "art") {
    const size = box ?? HUD_CLOSE_BOX;
    return (
      <View {...hoverProps} style={style} tooltip={tooltip}>
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label ?? tooltip}>
          {({ pressed }) => (
            <View style={{ width: size, height: size, borderRadius: radius ?? size / 2, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? closeOnArt.pressed : hovered ? closeOnArt.hover : closeOnArt.rest }}>
              <Symbol name="xmark" size={11} weight="medium" color={closeOnArt.glyph} style={{ width: size, height: size }} />
            </View>
          )}
        </Pressable>
      </View>
    );
  }
  const fill = hovered ? theme.hudCloseHover : theme.hudCloseFill;
  return (
    <View {...hoverProps} style={style} tooltip={tooltip}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label ?? tooltip}>
        <View style={HUD_PLATE}>
          <VisualEffect material="hudWindow" blendingMode="withinWindow" cornerRadius={HUD_CLOSE_BOX / 2} style={StyleSheet.absoluteFill} />
          <Surface style={StyleSheet.absoluteFill} fill={hex(fill)} cornerRadius={HUD_CLOSE_BOX / 2} borderColor={theme.hudCloseBorder} borderWidth={1} />
          <Symbol name="xmark" size={10} weight="medium" color={theme.hudCloseGlyph} style={HUD_GLYPH} />
        </View>
      </Pressable>
    </View>
  );
}

const PANEL_CLOSE_BOX = 22;
export const PANEL_CLOSE_GLYPH = 7;
export const PANEL_CLOSE_SIZE = PANEL_CLOSE_BOX;
const HUD_CLOSE_BOX = 23;
const HUD_PLATE = { width: HUD_CLOSE_BOX, height: HUD_CLOSE_BOX, borderRadius: HUD_CLOSE_BOX / 2, overflow: "hidden", alignItems: "center", justifyContent: "center" } as const;
const HUD_GLYPH = { width: HUD_CLOSE_BOX, height: HUD_CLOSE_BOX } as const;

function PushButtonView({ title, onPress, kind = "default", disabled, icon, style }: PushProps) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const primary = kind === "primary";
  const plain = kind === "plain";
  const textColor = primary ? theme.onAccent : kind === "destructive" ? theme.destructive : plain ? theme.formAccent : theme.textPrimary;
  return (
    <View {...hoverProps} style={[{ opacity: disabled ? opacity.disabled : 1 }, style]}>
      <Pressable disabled={disabled} onPress={onPress}>
        {({ pressed }) => (
          <View
            style={{
              height: plain ? undefined : 22,
              borderRadius: radii.control,
              paddingHorizontal: plain ? 0 : space.ml,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              backgroundColor: plain ? undefined : primary ? (pressed ? theme.formAccentPressed : theme.formAccent) : pressed ? theme.controlPressed : hovered ? theme.controlHover : theme.control,
              borderWidth: plain || primary ? 0 : StyleSheet.hairlineWidth * 2,
              borderColor: theme.controlBorder,
            }}
          >
            {icon ? <Symbol name={icon} size={11} color={textColor} style={{ width: 13, height: 13 }} /> : null}
            <Text style={{ ...typeScale.body, color: textColor, textDecorationLine: plain && hovered ? "underline" : "none" }}>{title}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

