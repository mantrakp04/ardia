import { Image, StyleSheet, Text, View } from "react-native";
import { CheckMark, useOnboardingColors } from "./Parts";
import { font } from "../ui/tokens";
import { onboardingType } from "./tokens";

const ICON = require("../../../assets/app-icon.png");

export function SetupLines({ heading, lines }: { heading: string; lines: string[] }) {
  const colors = useOnboardingColors();
  return (
    <View style={{ alignItems: "center", gap: 22 }}>
      <Image source={ICON} style={{ width: 72, height: 72 }} />
      <View
        style={{
          width: 260,
          padding: 18,
          gap: 8,
          borderRadius: 14,
          backgroundColor: colors.card,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.rowBorder,
        }}
      >
        <Text style={{ ...font.caption, lineHeight: 15, color: colors.subtitle }}>{heading}</Text>
        {lines.map((line) => (
          <View key={line} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
            <View style={{ paddingTop: 1 }}>
              <CheckMark on size={15} />
            </View>
            <Text style={{ flex: 1, ...onboardingType.bodyCompact, lineHeight: 17, color: colors.title }}>{line}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
