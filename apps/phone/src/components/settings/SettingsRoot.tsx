import { Pressable, StyleSheet, Text, View } from "react-native";
import { openArchive } from "../../state/browse/store";
import { showOnboarding } from "../../state/onboarding/store";
import { appVersion, exportOpenTabs, setAppearance, setArchiveInterval, setAutoOpenKeyboard, setColorChoice, setSearchSuggestions, useEngines } from "../../state/settings/actions";
import { usePreferences } from "../../state/settings/hooks";
import { closeSettings, pushSettings } from "../../state/settings/nav";
import { APPEARANCES } from "../../state/settings/settingsRules";
import { AUTO_ARCHIVE_INTERVALS, autoArchiveTitle, type AutoArchiveInterval } from "../../state/tabs/tabModels";
import { capsule, font, PROFILE_COLORS, settingsLayout, settingsTint, space, Symbol, useTheme, type ProfileColor } from "../ui";
import { BarButton, Group, IconTile, NavRow, PickerRow, SettingsPage, ToggleRow } from "./SettingsKit";

const INTERVALS = (Object.keys(AUTO_ARCHIVE_INTERVALS) as AutoArchiveInterval[]).map((id) => ({ id, title: autoArchiveTitle(id) }));

export function SettingsRoot() {
  const theme = useTheme();
  const engineId = usePreferences((p) => p.searchEngineId);
  const suggestions = usePreferences((p) => p.searchSuggestions);
  const keyboard = usePreferences((p) => p.autoOpensKeyboard);
  const interval = usePreferences((p) => p.autoArchiveInterval);
  const appearance = usePreferences((p) => p.appearance);
  const engines = useEngines((s) => s.engines);
  const engineName = engines.find((engine) => engine.id === engineId)?.name ?? "";
  return (
    <SettingsPage title="Settings" trailing={<BarButton title="Done" emphasized onPress={closeSettings} />}>
      <View style={styles.shortcuts}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            closeSettings();
            openArchive();
          }}
          style={[styles.shortcut, { backgroundColor: theme.groupFill }]}
        >
          <Symbol name="archivebox" size={20} color={theme.label} />
          <Text style={[font.body, styles.medium, { color: theme.label }]}>Archive</Text>
        </Pressable>
      </View>
      <Group>
        <ColorRow />
        <PickerRow title="Appearance" icon="moonFill" tint={settingsTint.nightShade} options={APPEARANCES} selected={appearance} onSelect={setAppearance} />
      </Group>
      <Group>
        <NavRow title="Site Settings" icon="globe" tint={settingsTint.neutral} onPress={() => pushSettings({ page: "siteSettings" })} />
      </Group>
      <Group>
        <NavRow title="Search Engine" icon="magnifyingglass" tint={settingsTint.search} value={engineName} divider onPress={() => pushSettings({ page: "searchEngine" })} />
        <ToggleRow title="Search Suggestions" icon="textMagnifyingglass" tint={settingsTint.blue} value={suggestions} divider onChange={setSearchSuggestions} />
        <ToggleRow title="Auto-Open Keyboard" icon="keyboardFill" tint={settingsTint.keyboard} value={keyboard} onChange={setAutoOpenKeyboard} />
      </Group>
      <Group>
        <PickerRow title="Archive Inactive Tabs" icon="archivebox" tint={settingsTint.archive} options={INTERVALS} selected={interval} divider onSelect={setArchiveInterval} />
        <NavRow title="Clear Browsing Data" icon="eraserFill" tint={settingsTint.clearData} divider onPress={() => pushSettings({ page: "clearData" })} />
        <NavRow title="Downloads" icon="arrowDownCircle" tint={settingsTint.downloads} divider onPress={() => pushSettings({ page: "downloads" })} />
        <Pressable accessibilityRole="button" onPress={exportOpenTabs} style={({ pressed }) => [styles.row, pressed ? { backgroundColor: theme.rowHighlight } : null]}>
          <IconTile icon="squareAndArrowUp" tint={settingsTint.export} />
          <Text style={[font.body, { color: theme.label }]}>Export Open Tabs</Text>
        </Pressable>
      </Group>
      <Group>
        <Pressable accessibilityRole="button" onPress={showOnboarding} style={({ pressed }) => [styles.row, pressed ? { backgroundColor: theme.rowHighlight } : null]}>
          <IconTile icon="handWave" tint={settingsTint.onboarding} />
          <Text style={[font.body, { color: theme.label }]}>Show Onboarding</Text>
        </Pressable>
        <View style={[styles.divider, { backgroundColor: theme.separator }]} />
        <NavRow title="About Ardia" icon="info" tint={settingsTint.neutral} onPress={() => pushSettings({ page: "about" })} />
      </Group>
      <Text style={[font.footnote, styles.centered, { color: theme.secondaryLabel }]}>{appVersion()}</Text>
    </SettingsPage>
  );
}

const COLORS = Object.keys(PROFILE_COLORS) as ProfileColor[];

function ColorRow() {
  const theme = useTheme();
  const chosen = usePreferences((p) => p.colorChoice) ?? "plum";
  return (
    <View style={styles.colorRow}>
      <View style={styles.colorLabel}>
        <IconTile icon="paintpaletteFill" tint={PROFILE_COLORS[chosen].swatch} />
        <Text style={[font.body, { color: theme.label }]}>Color</Text>
      </View>
      <View style={styles.swatches} accessibilityRole="radiogroup">
        {COLORS.map((color) => {
          const selected = color === chosen;
          const swatch = PROFILE_COLORS[color].swatch;
          return (
            <Pressable
              key={color}
              accessibilityRole="radio"
              accessibilityLabel={PROFILE_COLORS[color].name}
              accessibilityState={{ selected }}
              onPress={() => setColorChoice(color)}
              style={styles.swatchHit}
            >
              <View style={[styles.ring, { borderColor: selected ? swatch : theme.groupFill }]}>
                <View style={[styles.swatch, { backgroundColor: swatch }]} />
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const RING = settingsLayout.swatch + (settingsLayout.swatchGap + settingsLayout.swatchRing) * 2;

const styles = StyleSheet.create({
  shortcuts: { flexDirection: "row", paddingHorizontal: space.l, gap: space.m },
  shortcut: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.s, minHeight: 48, borderRadius: capsule(48) },
  medium: { fontWeight: "500" },
  row: { flexDirection: "row", alignItems: "center", gap: settingsLayout.labelGap, minHeight: settingsLayout.rowMinHeight, paddingHorizontal: settingsLayout.rowInset },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: settingsLayout.rowInset + settingsLayout.tile + settingsLayout.labelGap },
  centered: { textAlign: "center" },
  colorRow: { paddingHorizontal: settingsLayout.rowInset, paddingVertical: space.m, gap: space.m },
  colorLabel: { flexDirection: "row", alignItems: "center", gap: settingsLayout.labelGap },
  swatches: { flexDirection: "row" },
  swatchHit: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center" },
  ring: { width: RING, height: RING, borderRadius: capsule(RING), borderWidth: settingsLayout.swatchRing, alignItems: "center", justifyContent: "center" },
  swatch: { width: settingsLayout.swatch, height: settingsLayout.swatch, borderRadius: capsule(settingsLayout.swatch) },
});
