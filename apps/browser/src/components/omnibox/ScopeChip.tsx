import { useInterfaceMetrics, scaleInterfaceStyle } from "../ui/interfaceSize";
import { scaleMetrics } from "../../lib/interfaceMetrics";
import { useMemo } from "react";
import type { SearchScope } from "@ardia/core";
import { View } from "react-native";
import { Symbol, Text, useTheme } from "../ui";
import { Favicon } from "../favicon/Favicon";
import { BAR_TYPE, SCOPE_CHIP } from "./tokens";

export function ScopeChip({ scope, large }: { scope: SearchScope; large: boolean }) {
  const interfaceScale = useInterfaceMetrics().factor;
  const { SCOPE_CHIP, BAR_TYPE } = useMemo(() => ({ SCOPE_CHIP: scaleMetrics(BASE_INTERFACE_METRICS.SCOPE_CHIP, interfaceScale), BAR_TYPE: BASE_INTERFACE_METRICS.BAR_TYPE }), [interfaceScale]);
  const theme = useTheme();
  return (
    <View
      style={{
        height: large ? SCOPE_CHIP.heroHeight : SCOPE_CHIP.height,
        borderRadius: SCOPE_CHIP.radius,
        paddingLeft: SCOPE_CHIP.left,
        paddingRight: SCOPE_CHIP.right,
        gap: SCOPE_CHIP.gap,
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: theme.rowSelected,
      }}
    >
      {scope.host ? (
        <Favicon url={`https://${scope.host}`} size={BASE_INTERFACE_METRICS.SCOPE_CHIP.favicon} />
      ) : (
        <Symbol name="text.magnifyingglass" size={BASE_INTERFACE_METRICS.SCOPE_CHIP.favicon} color={theme.textSecondary} style={{ width: SCOPE_CHIP.favicon, height: SCOPE_CHIP.favicon }} />
      )}
      <Text lines={1} weight="medium" style={[large ? BAR_TYPE.heroScope : BAR_TYPE.scope, { maxWidth: SCOPE_CHIP.maxWidth }]}>
        {scope.name}
      </Text>
    </View>
  );
}

const BASE_INTERFACE_METRICS = { SCOPE_CHIP, BAR_TYPE };
