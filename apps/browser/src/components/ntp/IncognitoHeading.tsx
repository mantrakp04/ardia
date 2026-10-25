import { Symbol } from "@ardia/shell";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTheme } from "../../lib/theme";

export const INCOGNITO_ICON = "eyeglasses";
const GAP_ABOVE_MARK = 12;

export function IncognitoHeading({ left, bottom, width }: { left: number; bottom: number; width: number }) {
  const theme = useTheme();
  const [height, setHeight] = useState(0);
  return (
    <View
      pointerEvents="none"
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
      style={{ position: "absolute", left, top: bottom - height - GAP_ABOVE_MARK, width, alignItems: "center", gap: 6, opacity: height ? 1 : 0 }}
    >
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
