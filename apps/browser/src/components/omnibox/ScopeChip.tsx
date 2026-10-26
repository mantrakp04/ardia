import type { SearchScope } from "@ardia/core";
import { View } from "react-native";
import { Text, useTheme } from "../ui";
import { Favicon } from "../favicon/Favicon";
import { BAR_TYPE, SCOPE_CHIP } from "./tokens";

export function ScopeChip({ scope, large }: { scope: SearchScope; large: boolean }) {
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
      <Favicon url={`https://${scope.host}`} size={SCOPE_CHIP.favicon} />
      <Text lines={1} weight="medium" style={[large ? BAR_TYPE.heroScope : BAR_TYPE.scope, { maxWidth: SCOPE_CHIP.maxWidth }]}>
        {scope.name}
      </Text>
    </View>
  );
}
