import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { capsule, font, space, Symbol, tabsInk, tabsLayout, useTheme } from "../ui";

export function DeckEmpty({ centerY, showsArchive, onArchive }: { centerY: number; showsArchive: boolean; onArchive: () => void }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  return (
    <View style={[styles.empty, { top: centerY - space.huge * 2, left: (width - tabsLayout.emptyWidth) / 2, width: tabsLayout.emptyWidth }]}>
      <Text style={[font.title3, styles.emptyTitle, { color: theme.headerText }]}>No Open Tabs</Text>
      <Text style={[font.subheadline, styles.centered, { color: theme.secondaryLabel }]}>Tabs you open appear here. Inactive tabs move to the Archive.</Text>
      {showsArchive ? (
        <Pressable accessibilityRole="button" onPress={onArchive} style={styles.archive}>
          <Text style={[font.subheadline, styles.bold, { color: theme.formAccent }]}>Open Archive</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function IncognitoChip({ count, top, onPress }: { count: number; top: number; onPress: () => void }) {
  const { width } = useWindowDimensions();
  return (
    <View style={[styles.chipRow, { top, width }]} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Incognito, ${count} tabs`}
        accessibilityHint="Shows the option to close incognito tabs."
        onPress={onPress}
        style={[styles.chip, { backgroundColor: tabsInk.incognitoCard, borderRadius: capsule(tabsLayout.chipHeight) }]}
      >
        <Symbol name="eyes" size={16} color={tabsInk.onDark} />
        <Text style={[font.subheadline, styles.bold, styles.chipText]}>Incognito</Text>
        <Text style={[font.subheadline, styles.bold, { color: tabsInk.onDarkChip }]}>{count}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { position: "absolute", alignItems: "center", gap: space.xs + 2 },
  emptyTitle: { fontWeight: "600", textAlign: "center" },
  centered: { textAlign: "center" },
  bold: { fontWeight: "600" },
  archive: { minHeight: 44, justifyContent: "center", paddingHorizontal: space.m, marginTop: space.xs + 2 },
  chipRow: { position: "absolute", left: 0, height: 44, alignItems: "center", justifyContent: "center" },
  chip: { flexDirection: "row", alignItems: "center", gap: space.xs + 2, minHeight: tabsLayout.chipHeight, paddingHorizontal: space.m },
  chipText: { color: tabsInk.onDark },
});
