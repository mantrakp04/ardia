import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { tileGradient } from "../../lib/favicon";
import { linearGradientCss } from "../../lib/gradient";
import { hideArchiveCard, hideArchiveCardSoon } from "../../state/browse/archiveCard";
import { setArchiveInterval } from "../../state/settings/actions";
import { usePreferences } from "../../state/settings/hooks";
import { AUTO_ARCHIVE_INTERVALS, autoArchiveTitle, type AutoArchiveInterval } from "../../state/tabs/tabModels";
import { archiveCardLayout, FloatingMenu, font, ink, radius, shadowRadius, space, Symbol, tabsLayout, tabsMotion, useTheme } from "../ui";

const INTERVALS = Object.keys(AUTO_ARCHIVE_INTERVALS) as AutoArchiveInterval[];

export function ArchiveIntervalCard({ centerY }: { centerY: number }) {
  const theme = useTheme();
  const interval = usePreferences((p) => p.autoArchiveInterval);
  const picker = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const side = archiveCardLayout.tile;
  return (
    <Animated.View
      entering={FadeIn.duration(tabsMotion.fade)}
      exiting={FadeOut.duration(tabsMotion.fade)}
      pointerEvents="box-none"
      style={[styles.place, { top: centerY - archiveCardLayout.tile }]}
    >
      <View
        accessibilityActions={[{ name: "dismiss", label: "Dismiss" }]}
        onAccessibilityAction={() => hideArchiveCard()}
        style={[styles.card, { backgroundColor: theme.panel, shadowColor: theme.trayShadow }]}
      >
        <View style={styles.label}>
          <View style={[styles.tile, { width: side, height: side, borderRadius: side * 0.25, experimental_backgroundImage: linearGradientCss(tileGradient(archiveCardLayout.tint), false, side, side) }]}>
            <Symbol name="archivebox" size={side * 0.55} color={ink.white} />
          </View>
          <Text style={[font.body, { color: theme.label }]}>Archive Inactive Tabs</Text>
        </View>
        <Pressable ref={picker} accessibilityRole="button" accessibilityLabel="Archive Inactive Tabs" accessibilityValue={{ text: autoArchiveTitle(interval) }} onPress={() => setOpen(true)} style={styles.picker}>
          <Text style={[font.body, { color: theme.secondaryLabel }]}>{autoArchiveTitle(interval)}</Text>
          <Symbol name="chevronUpChevronDown" size={14} color={theme.secondaryLabel} />
        </Pressable>
      </View>
      {open ? (
        <FloatingMenu
          anchor={picker}
          items={INTERVALS.map((option) => ({
            label: autoArchiveTitle(option),
            checked: option === interval,
            onPress: () => {
              if (option === interval) return;
              setArchiveInterval(option);
              hideArchiveCardSoon();
            },
          }))}
          place={{ top: 0, right: space.l, width: tabsLayout.menuWidth }}
          onDismiss={() => setOpen(false)}
        />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  place: { position: "absolute", left: space.l, right: space.l, alignItems: "center" },
  card: {
    width: "100%",
    maxWidth: archiveCardLayout.maxWidth,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    rowGap: space.xs,
    paddingLeft: space.m + 2,
    paddingRight: space.xs,
    paddingVertical: space.m + 2,
    borderRadius: archiveCardLayout.radius,
    shadowOpacity: 0.18,
    shadowRadius: shadowRadius.lifted,
    elevation: 12,
  },
  label: { flexDirection: "row", alignItems: "center", gap: space.m },
  tile: { alignItems: "center", justifyContent: "center" },
  picker: { flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: 44, paddingHorizontal: space.s + 2, borderRadius: radius.row },
});
