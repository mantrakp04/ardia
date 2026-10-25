import { Symbol } from "@ardia/shell";
import { Text, View } from "react-native";
import { useTheme } from "../../lib/theme";

export const INCOGNITO_ICON = "eyeglasses";

export function IncognitoHeading({ left, top, width }: { left: number; top: number; width: number }) {
  const theme = useTheme();
  return (
    <View pointerEvents="none" style={{ position: "absolute", left, top, width, alignItems: "center", gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Symbol name={INCOGNITO_ICON} size={24} weight="medium" color={theme.textPrimary} style={{ width: 32, height: 28 }} />
        <Text numberOfLines={1} style={{ fontSize: 30, fontWeight: "700", letterSpacing: -0.4, color: theme.textPrimary }}>
          Incognito
        </Text>
      </View>
      <Text style={{ fontSize: 13, lineHeight: 18, color: theme.textSecondary, textAlign: "center", maxWidth: 460 }}>
        Pages you visit here aren't saved to your history, and their cookies and site data are cleared when the window closes.
      </Text>
    </View>
  );
}
