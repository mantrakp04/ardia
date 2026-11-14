import { StyleSheet, Text, View } from "react-native";
import { tileGradient } from "../../lib/favicon";
import { linearGradientCss } from "../../lib/gradient";
import { ArdiaLogo, font, ink, onboardingArt, PROFILE_COLORS, space, Symbol, useTheme } from "../ui";

export function LinkBubble() {
  const theme = useTheme();
  const icon = onboardingArt.appIcon;
  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.card, { backgroundColor: theme.groupFill, shadowColor: theme.trayShadow }]}>
        <View style={[styles.strip, { experimental_backgroundImage: linearGradientCss(tileGradient(PROFILE_COLORS.plum.swatch), false, 1, 1) }]} />
        <View style={styles.words}>
          <Text style={[font.subheadline, styles.bold, { color: theme.label }]} numberOfLines={1}>
            The best tapas in Lisbon
          </Text>
          <Text style={[font.caption, { color: theme.secondaryLabel }]}>timeout.com</Text>
        </View>
      </View>
      <View style={styles.arrow}>
        <Symbol name="arrowRight" size={22} color={theme.formAccent} />
      </View>
      <View style={[styles.icon, { width: icon, height: icon, borderRadius: icon * 0.225, backgroundColor: ink.white, borderColor: theme.separator, shadowColor: theme.trayShadow }]}>
        <ArdiaLogo width={icon * 0.72} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-end", gap: space.m },
  card: {
    width: onboardingArt.linkCardWidth,
    borderRadius: onboardingArt.linkCardRadius,
    overflow: "hidden",
    elevation: 6,
    shadowOpacity: 0.08,
    shadowRadius: onboardingArt.shadowRadius,
  },
  strip: { minHeight: onboardingArt.stripHeight },
  words: { paddingHorizontal: space.m, paddingVertical: space.s + 2, gap: space.tight },
  bold: { fontWeight: "700" },
  arrow: { paddingBottom: onboardingArt.arrowLift },
  icon: { alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, marginBottom: space.s, elevation: 6, shadowOpacity: 0.12, shadowRadius: onboardingArt.shadowRadius },
});
