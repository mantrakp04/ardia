import { useInterfaceMetrics, scaleInterfaceStyle } from "./interfaceSize";
import { scaleMetrics } from "../../lib/interfaceMetrics";
import { memo, useMemo, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import { useTheme } from "./theme";
import { radius as radii, space, type ColorRole, type Radius, type Space } from "./tokens";

export type BoxProps = Omit<ViewProps, "style"> & {
  pad?: Space;
  padX?: Space;
  padY?: Space;
  gap?: Space;
  fill?: ColorRole;
  border?: ColorRole;
  radius?: Radius;
  row?: boolean;
  center?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

export const Box = memo(function Box({ pad, padX, padY, gap, fill, border, radius, row, center, style, children, ...rest }: BoxProps) {
  const interfaceScale = useInterfaceMetrics().factor;
  const { space, radii } = useMemo(() => ({ space: scaleMetrics(BASE_INTERFACE_METRICS.space, interfaceScale), radii: scaleMetrics(BASE_INTERFACE_METRICS.radii, interfaceScale) }), [interfaceScale]);
  const theme = useTheme();
  const fillColor = fill ? theme[fill] : undefined;
  const borderColor = border ? theme[border] : undefined;
  const tokens = useMemo<ViewStyle>(
    () => ({
      padding: pad ? space[pad] : undefined,
      paddingHorizontal: padX ? space[padX] : undefined,
      paddingVertical: padY ? space[padY] : undefined,
      gap: gap ? space[gap] : undefined,
      backgroundColor: fillColor,
      borderColor,
      borderWidth: borderColor ? StyleSheet.hairlineWidth * 2 : undefined,
      borderRadius: radius ? radii[radius] : undefined,
      flexDirection: row ? "row" : undefined,
      alignItems: center ? "center" : undefined,
      justifyContent: center ? "center" : undefined,
    }),
    [pad, padX, padY, gap, fillColor, borderColor, radius, row, center, interfaceScale],
  );
  return (
    <View {...rest} style={style ? [tokens, style] : tokens}>
      {children}
    </View>
  );
});

const BASE_INTERFACE_METRICS = { space, radii };
