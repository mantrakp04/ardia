import { ContextMenuArea, Symbol, type SymbolProps } from "@ardia/shell";
import { memo, useEffect, useRef, type ReactNode } from "react";
import { Animated, Image, Pressable, Text, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from "react-native";
import { modifiersOf, type ClickModifiers } from "../../lib/keys";
import { curve, period } from "./motion";
import { useToolbarRowContext } from "./toolbarRowContext";
import { useHover } from "./useHover";
import { CloseButtonView, PillButtonView, PushButtonView, StepperButtonView } from "./ButtonKinds";
import { useTheme } from "./theme";
import { capsule, iconButton, opacity, radius as radii, space, font as typeScale, weight as weights, type ColorRole, type IconButtonSize, type Space, type TypeSize, type Weight } from "./tokens";

export type ButtonHit = { width: number; height: number; plateX: number; plateY: number; box?: number; radius?: number };

export type IconPalette = { icon: string; iconDisabled: string; hover: string; pressed: string };

type IconBase = {
  variant: "icon";
  icon?: string;
  disabled?: boolean;
  active?: boolean;
  size?: IconButtonSize;
  glyph?: number;
  look?: "field" | "row" | "extension";
  capsule?: boolean;
  spinning?: boolean;
  image?: string;
  badge?: ReactNode;
  children?: ReactNode;
  box?: number;
  glyphBox?: number;
  radius?: number;
  weight?: SymbolProps["weight"];
  tooltip?: string;
  palette?: IconPalette;
  color?: string;
  style?: StyleProp<ViewStyle>;
  hit?: ButtonHit;
};

type IconProps = IconBase &
  ({ toolbar?: false; onPress?: (press: GestureResponderEvent) => void } | { toolbar: true; onPress?: (modifiers: ClickModifiers) => void; onLongPress?: () => void; onContextMenu?: () => void });

type TextLook = "toolbar" | "panel" | "link";

type TextProps = {
  variant: "text";
  title: string;
  onPress: () => void;
  disabled?: boolean;
  look?: TextLook;
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

export type PillSize = "m" | "l" | "xl";

export type PillProps = { variant: "pill"; onPress: () => void; title: string; primary?: boolean; size?: PillSize } & ({ tone?: "prompt" } | { tone: "chip"; icon?: string; height?: number });

export type StepperProps = { variant: "stepper"; icon: string; onPress: () => void; width?: number; height?: number; tooltip: string; disabled?: boolean };

export type CloseProps = { variant: "close"; onPress: () => void; tooltip?: string; label?: string; style?: StyleProp<ViewStyle> } & (
  | { look: "hud" | "panel" }
  | { look: "art"; box?: number; radius?: number }
);

export type PushProps = {
  variant?: "push";
  title: string;
  onPress: () => void;
  kind?: "default" | "primary" | "destructive" | "plain";
  disabled?: boolean;
  icon?: string;
  style?: StyleProp<ViewStyle>;
};

export type ButtonProps = IconProps | TextProps | PillProps | StepperProps | CloseProps | PushProps;

export const Button = memo(function Button(props: ButtonProps) {
  switch (props.variant) {
    case "icon":
      return <IconButtonView {...props} />;
    case "text":
      return <TextButtonView {...props} />;
    case "pill":
      return <PillButtonView {...props} />;
    case "stepper":
      return <StepperButtonView {...props} />;
    case "close":
      return <CloseButtonView {...props} />;
    default:
      return <PushButtonView {...props} />;
  }
});

const ROW_GLYPH = 13;
const EXTENSION_GLYPH = 14;
const IMAGE_SIZE = 16;

function useIconMetrics(props: IconProps) {
  const row = useToolbarRowContext();
  if (props.look === "field") return { box: props.box ?? row.fieldButton, glyph: props.glyph ?? ROW_GLYPH, radius: props.radius ?? row.fieldButtonRadius };
  if (props.look === "row") return { box: props.box ?? row.button, glyph: props.glyph ?? ROW_GLYPH, radius: props.radius ?? row.buttonRadius };
  if (props.look === "extension") return { box: props.box ?? row.extensionButton, glyph: props.glyph ?? EXTENSION_GLYPH, radius: props.radius ?? row.buttonRadius };
  const size = props.size ?? "toolbar";
  const step = iconButton[size];
  return { box: props.box ?? step.box, glyph: props.glyph ?? step.glyph, radius: props.radius ?? (size === "toolbar" ? radii.toolbar : radii.control) };
}

function Spinning({ spinning, children }: { spinning: boolean; children: ReactNode }) {
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!spinning) return;
    turn.setValue(0);
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: period.spinner, easing: curve.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spinning]);
  if (!spinning) return <>{children}</>;
  return <Animated.View style={{ transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] }}>{children}</Animated.View>;
}

function IconButtonView(props: IconProps) {
  const { icon, disabled, active, glyphBox, weight = "regular", tooltip, palette, color, style, hit, spinning = false, image, badge, children } = props;
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const metrics = useIconMetrics(props);
  const hover = palette ? palette.hover : theme.toolbarHover;
  const pressedFill = palette ? palette.pressed : theme.toolbarPressed;
  const plateBox = hit?.box ?? metrics.box;
  const glyphFrame = glyphBox ?? plateBox;
  const ink = color ?? (disabled ? (palette ? palette.iconDisabled : theme.iconDisabled) : palette ? palette.icon : theme.icon);
  const face = children ?? (image ? (
    <View pointerEvents="none">
      <Image source={{ uri: image }} style={{ width: IMAGE_SIZE, height: IMAGE_SIZE, opacity: disabled ? opacity.disabled : 1 }} />
    </View>
  ) : icon ? (
    <Spinning spinning={spinning}>
      <Symbol name={icon} size={metrics.glyph} weight={weight} color={ink} style={{ width: glyphFrame, height: glyphFrame }} />
    </Spinning>
  ) : null);
  const plate = (pressed: boolean) => (
    <View
      style={{
        position: hit ? "absolute" : "relative",
        left: hit?.plateX,
        top: hit?.plateY,
        width: plateBox,
        height: plateBox,
        borderRadius: hit?.radius ?? (props.capsule ? capsule(plateBox) : metrics.radius),
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: disabled ? undefined : pressed || active ? pressedFill : hovered ? hover : undefined,
      }}
    >
      {face}
      {badge}
    </View>
  );
  if (!props.toolbar)
    return (
      <View tooltip={tooltip} style={style} {...hoverProps}>
        <Pressable onPress={props.onPress} disabled={disabled} style={hit ? { width: hit.width, height: hit.height } : undefined}>
          {({ pressed }) => plate(pressed)}
        </Pressable>
      </View>
    );
  const { onPress, onLongPress, onContextMenu } = props;
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

const TEXT_LOOKS: Record<TextLook, { plate: "toolbar" | "hover" | "none"; height?: number; pad: Space; size: TypeSize; weight: Weight; tone: ColorRole }> = {
  toolbar: { plate: "toolbar", height: 26, pad: "m", size: "small", weight: "medium", tone: "textPrimary" },
  panel: { plate: "hover", height: 22, pad: "m", size: "small", weight: "regular", tone: "textSecondary" },
  link: { plate: "none", pad: "m", size: "small", weight: "medium", tone: "accent" },
};

const UNDERLINE = { textDecorationLine: "underline" } as const;

function TextButtonView(props: TextProps) {
  const { title, onPress, disabled, look, hoverTone, padY, label } = props;
  const base = look ? TEXT_LOOKS[look] : null;
  const plate = props.plate ?? base?.plate ?? "toolbar";
  const height = props.height ?? base?.height;
  const pad = props.pad ?? base?.pad ?? "m";
  const size = props.size ?? base?.size ?? "small";
  const weight = props.weight ?? base?.weight ?? "medium";
  const tone = props.tone ?? base?.tone ?? "textPrimary";
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const a11y = label ? ({ accessibilityRole: "button", accessibilityLabel: label } as const) : undefined;
  const textStyle = (color: string) => ({ ...typeScale[size], ...(weight === "regular" ? null : { fontWeight: weights[weight] }), color });
  if (plate === "none")
    return (
      <View {...hoverProps}>
        <Pressable onPress={onPress} disabled={disabled} {...a11y}>
          <Text style={[textStyle(hovered && hoverTone ? theme[hoverTone] : theme[tone]), { paddingVertical: padY ? space[padY] : undefined }, look === "link" && hovered ? UNDERLINE : null]}>{title}</Text>
        </Pressable>
      </View>
    );
  const fill = (pressed: boolean) =>
    disabled ? undefined : plate === "toolbar" && pressed ? theme.toolbarPressed : hovered ? theme.toolbarHover : undefined;
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress} disabled={disabled} {...a11y}>
        {({ pressed }) => (
          <View style={{ height, paddingHorizontal: space[pad], borderRadius: radii.control, justifyContent: "center", backgroundColor: fill(pressed) }}>
            <Text style={textStyle(disabled ? theme.iconDisabled : hovered && hoverTone ? theme[hoverTone] : theme[tone])}>{title}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}
