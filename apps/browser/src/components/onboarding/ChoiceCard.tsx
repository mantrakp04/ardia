import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import { GlassFill, useGlass } from "../ui";
import { useTheme } from "../ui/theme";
import { onboardingColorsOf } from "./tokens";

export const CARD_BORDER = StyleSheet.hairlineWidth * 2;
export const SELECTED_BORDER = 1.5;
const DASHED_BORDER = 1;

export type ChoiceCardProps = Omit<ViewProps, "style"> & {
  radius: number;
  selected?: boolean;
  hovered?: boolean;
  raised?: boolean;
  dashed?: boolean;
  plain?: boolean;
  outline?: "strong" | "soft";
  fill?: string;
  border?: string | null;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

export function ChoiceCard({
  radius,
  selected = false,
  hovered = false,
  raised = selected,
  dashed = false,
  plain = false,
  outline = "strong",
  fill,
  border,
  style,
  children,
  ...rest
}: ChoiceCardProps) {
  const colors = onboardingColorsOf(useTheme());
  const glass = useGlass() && !plain && !dashed;
  const lit = selected || hovered;
  const strong = selected && outline === "strong";
  const borderWidth = border === null ? 0 : dashed ? DASHED_BORDER : strong ? SELECTED_BORDER : CARD_BORDER;
  const borderColor = border ?? (selected ? (strong ? colors.title : colors.checkboxBorder) : colors.rowBorder);
  const surface = fill ?? (lit ? colors.button : colors.row);
  return (
    <View
      {...rest}
      style={[
        {
          borderRadius: radius,
          backgroundColor: glass ? "transparent" : surface,
          borderWidth,
          borderColor,
          borderStyle: dashed ? "dashed" : undefined,
        },
        style,
      ]}
    >
      {glass ? (
        <>
          <GlassFill radius={radius} border={borderWidth} state={raised ? "active" : "rest"} />
          {lit ? (
            <View
              pointerEvents="none"
              style={{ position: "absolute", top: -borderWidth, left: -borderWidth, right: -borderWidth, bottom: -borderWidth, borderRadius: radius, borderCurve: "continuous", backgroundColor: colors.outlinedHover }}
            />
          ) : null}
        </>
      ) : null}
      {children}
    </View>
  );
}
