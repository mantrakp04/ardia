import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, SectionList, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { closeArchive, reopenArchived } from "../../state/browse/store";
import { display } from "../../state/search/omnibox";
import { usePreferences } from "../../state/settings/hooks";
import { useArchiveDays, useArchiveLoaded } from "../../state/tabs/hooks";
import { AUTO_ARCHIVE_INTERVALS, autoArchiveTitle, type AutoArchiveInterval, type BrowserTab } from "../../state/tabs/tabModels";
import { clearArchivedTabs, loadArchive, searchArchive, setAutoArchiveInterval } from "../../state/tabs/store";
import { Backdrop, font, Menu, radius, space, Symbol, tabsLayout, useTheme, type MenuItem } from "../ui";

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function dayTitle(at: number): string {
  const day = new Date(at);
  const today = new Date();
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(today) - start(day)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return day.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

export function ArchiveView() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const days = useArchiveDays();
  const loaded = useArchiveLoaded();
  const interval = usePreferences((p) => p.autoArchiveInterval);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState(false);
  useEffect(() => loadArchive(), []);
  const trimmed = query.trim();
  const results = useMemo(() => (trimmed ? searchArchive(trimmed) : null), [trimmed, days]);
  const sections = results
    ? [{ title: "", data: results }]
    : days.map((day) => ({ title: dayTitle(day.tabs[0]!.archivedAt ?? day.tabs[0]!.lastActive), data: day.tabs }));

  const confirmClear = () =>
    Alert.alert("Delete All Archived Tabs?", "This can’t be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete All", style: "destructive", onPress: clearArchivedTabs },
    ]);
  const items: MenuItem[] = [
    { heading: "Archive Inactive Tabs" },
    ...(Object.keys(AUTO_ARCHIVE_INTERVALS) as AutoArchiveInterval[]).map((option) => ({
      label: autoArchiveTitle(option),
      checked: option === interval,
      onPress: () => setAutoArchiveInterval(option),
    })),
    "divider",
    { label: "Delete All…", icon: "trash", destructive: true, onPress: confirmClear },
  ];

  return (
    <View style={StyleSheet.absoluteFill}>
      <Backdrop colors={theme.backdrop} />
      <View style={[styles.column, { paddingTop: insets.top }]}>
        <View style={styles.top}>
          <Pressable accessibilityRole="button" onPress={closeArchive} style={styles.topButton}>
            <Text style={[font.body, styles.bold, { color: theme.formAccent }]}>Done</Text>
          </Pressable>
          <Text accessibilityRole="header" style={[font.body, styles.bold, { color: theme.label }]}>
            Archive
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Options" onPress={() => setMenu(true)} style={[styles.topButton, styles.end]}>
            <Symbol name="ellipsis" size={22} color={theme.formAccent} />
          </Pressable>
        </View>
        <View style={[styles.search, { backgroundColor: theme.fieldFill }]}>
          <Symbol name="magnifyingglass" size={17} color={theme.secondaryLabel} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search Archive"
            placeholderTextColor={theme.secondaryLabel}
            style={[font.body, styles.input, { color: theme.label }]}
            selectionColor={theme.formAccent}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear Search" onPress={() => setQuery("")}>
              <Symbol name="xmarkCircleFill" size={18} color={theme.secondaryLabel} />
            </Pressable>
          ) : null}
        </View>
        {loaded && !sections.some((s) => s.data.length) ? (
          <View style={styles.empty}>
            <Text style={[font.title3, styles.bold, { color: theme.headerText }]}>{trimmed ? `No Results for “${trimmed}”` : "No Archived Tabs"}</Text>
            <Text style={[font.subheadline, { color: theme.secondaryLabel }]}>
              {trimmed ? "Check the spelling or try a new search." : "Closed and inactive tabs show up here."}
            </Text>
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(tab) => tab.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + space.l }}
            renderSectionHeader={({ section }) =>
              section.title ? <Text style={[font.footnote, styles.section, { color: theme.secondaryLabel }]}>{section.title}</Text> : null
            }
            renderItem={({ item }) => <ArchiveRow tab={item} />}
          />
        )}
      </View>
      {menu ? <Menu items={items} place={{ top: insets.top + tabsLayout.archiveTop, right: space.s, width: Math.min(tabsLayout.menuWidth, width - space.l) }} onDismiss={() => setMenu(false)} /> : null}
    </View>
  );
}

function ArchiveRow({ tab }: { tab: BrowserTab }) {
  const theme = useTheme();
  const shown = display(tab.url);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Reopens the tab."
      onPress={() => reopenArchived(tab)}
      style={({ pressed }) => [styles.row, pressed ? { backgroundColor: theme.rowHighlight } : null]}
    >
      <View style={[styles.icon, { backgroundColor: theme.fieldFill }]}>
        <Symbol name="globe" size={tabsLayout.faviconSize} color={theme.rowIcon} />
      </View>
      <View style={styles.label}>
        <Text style={[font.body, { color: theme.label }]} numberOfLines={1}>
          {tab.title || shown.host}
        </Text>
        <Text style={[font.footnote, { color: theme.secondaryLabel }]} numberOfLines={1}>
          {`${shown.host} · ${time(tab.archivedAt ?? tab.lastActive)}`}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  column: { flex: 1 },
  top: { minHeight: tabsLayout.archiveTop, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.s },
  topButton: { minWidth: tabsLayout.archiveButton, minHeight: tabsLayout.archiveButton, justifyContent: "center", paddingHorizontal: space.s },
  end: { alignItems: "flex-end" },
  bold: { fontWeight: "600" },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs + 2,
    marginHorizontal: space.l,
    marginVertical: space.s,
    paddingHorizontal: space.s + 2,
    minHeight: tabsLayout.archiveField,
    borderRadius: radius.field - space.xs,
  },
  input: { flex: 1, paddingVertical: space.s },
  section: { paddingHorizontal: space.xl, paddingTop: space.l, paddingBottom: space.xs, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: space.m, paddingHorizontal: space.l, paddingVertical: space.s, marginHorizontal: space.s, borderRadius: radius.row },
  icon: { width: tabsLayout.archiveTile, height: tabsLayout.archiveTile, borderRadius: tabsLayout.cardRadius - space.xs - 1, alignItems: "center", justifyContent: "center" },
  label: { flex: 1, gap: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.xs + 2, paddingHorizontal: space.xxl },
});
