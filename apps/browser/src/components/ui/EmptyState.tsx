import { View } from "react-native";
import { Symbol } from "./native";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { emptyState, space } from "./tokens";

const EMPTY = { flex: 1, alignItems: "center", justifyContent: "center", gap: space.m, paddingBottom: emptyState.liftBottom } as const;
const ICON = { width: emptyState.iconBox, height: emptyState.iconBox } as const;
const SUBTITLE = { textAlign: "center", maxWidth: emptyState.subtitleMaxWidth } as const;

export function EmptyState({ symbol, title, subtitle }: { symbol: string; title: string; subtitle?: string }) {
  const theme = useTheme();
  return (
    <View style={EMPTY}>
      <Symbol name={symbol} size={emptyState.icon} color={theme.textTertiary} style={ICON} />
      <Text size="title" weight="medium" tone="textSecondary">
        {title}
      </Text>
      {subtitle ? (
        <Text tone="textTertiary" style={SUBTITLE}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
