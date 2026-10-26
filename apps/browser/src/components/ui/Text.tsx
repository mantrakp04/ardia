import { memo, useMemo } from "react";
import { Text as NativeText, type StyleProp, type TextProps as NativeTextProps, type TextStyle } from "react-native";
import { useTheme } from "./theme";
import { font as typeScale, weight as weights, type ColorRole, type TypeSize, type Weight } from "./tokens";

export type TextProps = Omit<NativeTextProps, "style"> & {
  size?: TypeSize;
  weight?: Weight;
  tone?: ColorRole;
  lines?: number;
  style?: StyleProp<TextStyle>;
};

export const Text = memo(function Text({ size = "body", weight, tone = "textPrimary", lines, style, ...rest }: TextProps) {
  const theme = useTheme();
  const color = theme[tone];
  const tokens = useMemo<TextStyle>(() => ({ ...typeScale[size], fontWeight: weight ? weights[weight] : undefined, color }), [size, weight, color]);
  return <NativeText {...rest} numberOfLines={lines ?? rest.numberOfLines} style={style ? [tokens, style] : tokens} />;
});
