import { useInterfaceMetrics, scaleInterfaceStyle } from "./interfaceSize";
import { scaleMetrics } from "../../lib/interfaceMetrics";
import { useMemo } from "react";
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "./theme";
import { space, type Space } from "./tokens";

export function Divider({
  vertical,
  length,
  inset,
  color,
  thick,
  style,
}: {
  vertical?: boolean;
  length?: DimensionValue;
  inset?: Space;
  color?: string;
  thick?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const interfaceScale = useInterfaceMetrics().factor;
  const { space } = useMemo(() => ({ space: scaleMetrics(BASE_INTERFACE_METRICS.space, interfaceScale) }), [interfaceScale]);
  const theme = useTheme();
  const thickness = thick ? StyleSheet.hairlineWidth * 2 : StyleSheet.hairlineWidth;
  const margin = inset ? space[inset] : undefined;
  const line: ViewStyle = vertical
    ? { width: thickness, height: length, alignSelf: length === undefined ? "stretch" : undefined, marginVertical: margin, backgroundColor: color ?? theme.divider }
    : { height: thickness, width: length, marginHorizontal: margin, backgroundColor: color ?? theme.divider };
  return <View pointerEvents="none" style={style ? [line, style] : line} />;
}

const BASE_INTERFACE_METRICS = { space };
