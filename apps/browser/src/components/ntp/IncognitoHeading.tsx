import { useState } from "react";
import { Box, Symbol, Text, useTheme } from "../ui";
import { headingTop } from "./newTabLayout";
import { ntpType } from "./tokens";

export const INCOGNITO_ICON = "eyeglasses";

const BLURB = { lineHeight: 18, textAlign: "center", maxWidth: 460 } as const;
const ICON = { width: 32, height: 28 } as const;

export function IncognitoHeading({ left, barTop, width, onHeight }: { left: number; barTop: number; width: number; onHeight: (height: number) => void }) {
  const theme = useTheme();
  const [height, setHeight] = useState(0);
  return (
    <Box
      gap="s"
      pointerEvents="none"
      onLayout={(e) => {
        setHeight(e.nativeEvent.layout.height);
        onHeight(e.nativeEvent.layout.height);
      }}
      style={{ position: "absolute", left, top: headingTop(barTop, height), width, alignItems: "center", opacity: height ? 1 : 0 }}
    >
      <Box row gap="ml" style={CENTER_ROW}>
        <Symbol name={INCOGNITO_ICON} size={24} weight="medium" color={theme.textPrimary} style={ICON} />
        <Text accessibilityRole="header" lines={1} style={ntpType.incognitoTitle}>
          Incognito
        </Text>
      </Box>
      <Text size="body" tone="textSecondary" style={BLURB}>
        Pages you visit here aren't saved to your history. Cookies and site data are deleted when you close all Incognito windows.
      </Text>
    </Box>
  );
}

const CENTER_ROW = { alignItems: "center" } as const;
