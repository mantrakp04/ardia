import { Surface, Symbol, VisualEffect } from "@ardia/shell";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useHover } from "./useHover";
import { hex, useTheme, type Theme } from "./theme";
import { capsule, closeOnArt, opacity, pillHeight, radius as radii, space, stepperSize, font as typeScale, weight as weights } from "./tokens";
import type { CloseProps, PillProps, PushProps, StepperProps } from "./Button";

function pillLook(theme: Theme, tone: "prompt" | "chip", primary: boolean, pressed: boolean, hovered: boolean) {
  if (tone === "chip")
    return primary
      ? { fill: theme.textPrimary, text: theme.onPrimary, dim: pressed || hovered }
      : { fill: pressed ? theme.toolbarPressed : hovered ? theme.toolbarHover : theme.urlPill, text: theme.textPrimary, dim: false };
  return primary
    ? { fill: pressed ? theme.goButtonPressed : hovered ? theme.goButtonHover : theme.goButton, text: theme.onPrimary, dim: false }
    : { fill: pressed ? theme.promptFillPressed : hovered ? theme.promptFillHover : theme.promptFill, text: theme.textPrimary, dim: false };
}

export function StepperButtonView({ icon, onPress, width = stepperSize.width, height = stepperSize.height, tooltip, disabled }: StepperProps) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} style={{ opacity: disabled ? opacity.disabled : 1 }}>
      <Pressable disabled={disabled} onPress={onPress} tooltip={tooltip}>
        {({ pressed }) => (
          <View
            style={{
              width,
              height,
              borderRadius: radii.control,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? theme.controlPressed : hovered ? theme.controlHover : theme.control,
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderColor: theme.controlBorder,
            }}
          >
            <Symbol name={icon} size={10} weight="semibold" color={theme.icon} style={{ width: 12, height: 12 }} />
          </View>
        )}
      </Pressable>
    </View>
  );
}

const CHIP_DIM = 0.85;

export function PillButtonView(props: PillProps) {
  const { onPress, title, primary = false, size } = props;
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  if (props.tone === "chip") {
    const { icon, tone } = props;
    const chipHeight = props.height ?? pillHeight[size ?? "m"];
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
                  borderRadius: capsule(chipHeight),
                  paddingHorizontal: space.m,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: space.xs,
                  backgroundColor: look.fill,
                  opacity: look.dim ? CHIP_DIM : 1,
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
  const height = size ? pillHeight[size] : pillHeight.prompt;
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress}>
        {({ pressed }) => {
          const look = pillLook(theme, "prompt", primary, pressed, hovered);
          return (
            <View style={{ height, paddingHorizontal: space.l, borderRadius: size ? capsule(height) : radii.tile, alignItems: "center", justifyContent: "center", backgroundColor: look.fill }}>
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

export function CloseButtonView(props: CloseProps) {
  const { onPress, look, tooltip = "Dismiss", label, style } = props;
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  if (look === "panel")
    return (
      <View {...hoverProps} style={style} tooltip={tooltip}>
        <Pressable onPress={onPress}>
          <View style={{ width: PANEL_CLOSE_BOX, height: PANEL_CLOSE_BOX, borderRadius: radii.control, alignItems: "center", justifyContent: "center", backgroundColor: hovered ? theme.toolbarHover : undefined }}>
            <Symbol name="xmark" size={9} weight="semibold" color={theme.textSecondary} style={{ width: 14, height: 14 }} />
          </View>
        </Pressable>
      </View>
    );
  if (props.look === "art") {
    const size = props.box ?? ART_CLOSE_BOX;
    const corner = props.radius ?? capsule(size);
    return (
      <View {...hoverProps} style={style} tooltip={tooltip}>
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label ?? tooltip}>
          {({ pressed }) => (
            <View style={{ width: size, height: size, borderRadius: corner, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? closeOnArt.pressed : hovered ? closeOnArt.hover : closeOnArt.rest }}>
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
          <VisualEffect material="hudWindow" blendingMode="withinWindow" cornerRadius={capsule(HUD_CLOSE_BOX)} style={StyleSheet.absoluteFill} />
          <Surface style={StyleSheet.absoluteFill} fill={hex(fill)} cornerRadius={capsule(HUD_CLOSE_BOX)} borderColor={theme.hudCloseBorder} borderWidth={1} />
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
const ART_CLOSE_BOX = 22;
const HUD_PLATE = { width: HUD_CLOSE_BOX, height: HUD_CLOSE_BOX, borderRadius: capsule(HUD_CLOSE_BOX), overflow: "hidden", alignItems: "center", justifyContent: "center" } as const;
const HUD_GLYPH = { width: HUD_CLOSE_BOX, height: HUD_CLOSE_BOX } as const;

export function PushButtonView({ title, onPress, kind = "default", disabled, icon, style }: PushProps) {
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
              gap: space.xs,
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
