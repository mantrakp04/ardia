import { Pressable, StyleSheet, Text, View } from "react-native";
import { setBlockingCategory, setCollapsesBottomBar, setDefaultNightShade, setSwipeNavigation, setSearchEngine, useBlocking, useEngines } from "../../state/settings/actions";
import { usePreferences } from "../../state/settings/hooks";
import { popSettings, pushSettings } from "../../state/settings/nav";
import { formatNumber } from "../../state/settings/settingsRules";
import { font, settingsLayout, settingsTint, Symbol, useTheme } from "../ui";
import { Divider, Group, NavRow, PickerRow, SettingsPage, ToggleRow, ValueRow } from "./SettingsKit";
import { useSyncEnabled, useSyncView } from "../../state/sync/hooks";
import { syncedEngineName } from "../../state/sync/syncRules";

const SWIPE_NAVIGATION = [
  { id: "anywhere" as const, title: "From Anywhere" },
  { id: "screenEdges" as const, title: "From Screen Edges" },
  { id: "disabled" as const, title: "Off" },
];

const NIGHT_SHADE = [
  { id: "disabled" as const, title: "Off" },
  { id: "automatic" as const, title: "Automatic" },
  { id: "always" as const, title: "Always" },
];

export function SearchEnginePage() {
  const theme = useTheme();
  const engines = useEngines((s) => s.engines);
  const selected = usePreferences((p) => p.searchEngineId);
  const syncEnabled = useSyncEnabled();
  const synced = useSyncView().search;
  if (syncEnabled && synced) {
    return (
      <SettingsPage title="Search Engine" onBack={popSettings}>
        <Group footer="Set on your Mac.">
          <ValueRow title="From Your Mac" value={syncedEngineName(synced, engines)} />
        </Group>
      </SettingsPage>
    );
  }
  return (
    <SettingsPage title="Search Engine" onBack={popSettings}>
      <Group>
        {engines.map((engine, index) => (
          <View key={engine.id}>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: engine.id === selected }}
              onPress={() => setSearchEngine(engine.id)}
              style={({ pressed }) => [styles.row, pressed ? { backgroundColor: theme.rowHighlight } : null]}
            >
              <Text style={[font.body, styles.fill, { color: theme.label }]}>{engine.name}</Text>
              {engine.id === selected ? <Symbol name="checkmark" size={18} color={theme.formAccent} /> : null}
            </Pressable>
            {index < engines.length - 1 ? <Divider /> : null}
          </View>
        ))}
      </Group>
    </SettingsPage>
  );
}

export function SiteSettingsPage() {
  const state = useBlocking((s) => s.state);
  const nightShade = useEngines((s) => s.nightShade);
  const enabledLists = state?.lists.filter((list) => list.isEnabled).length ?? 0;
  const trusted = state?.exemptHosts.length ?? 0;
  const swipe = usePreferences((p) => p.swipeNavigation);
  const collapses = usePreferences((p) => p.collapsesBottomBar);
  return (
    <SettingsPage title="Site Settings" onBack={popSettings}>
      <Group>
        <ToggleRow title="Block Ads" icon="handRaised" tint={settingsTint.ads} value={state?.blocksAds ?? true} divider onChange={(on) => setBlockingCategory("ads", on)} />
        <ToggleRow title="Block Trackers" icon="eyeglasses" tint={settingsTint.trackers} value={state?.blocksTrackers ?? true} divider onChange={(on) => setBlockingCategory("trackers", on)} />
        <ToggleRow
          title="Block Cookie Banners"
          icon="listBulletFill"
          tint={settingsTint.cookies}
          value={state?.hidesCookieBanners ?? true}
          divider
          onChange={(on) => setBlockingCategory("cookieBanners", on)}
        />
        <NavRow title="Filter Lists" icon="line3HorizontalDecrease" tint={settingsTint.neutral} value={formatNumber(enabledLists)} divider onPress={() => pushSettings({ page: "filterLists" })} />
        <NavRow title="Trusted Sites" icon="checkmarkShield" tint={settingsTint.green} value={trusted ? String(trusted) : "None"} onPress={() => pushSettings({ page: "trustedSites" })} />
      </Group>
      <Group footer="Change one site from its page menu.">
        <PickerRow title="Night Shade" icon="moonFill" tint={settingsTint.nightShade} options={NIGHT_SHADE} selected={nightShade} divider onSelect={setDefaultNightShade} />
        <PickerRow
          title="Swipe to Navigate"
          icon="handDrawFill"
          tint={settingsTint.swipe}
          options={SWIPE_NAVIGATION}
          selected={swipe}
          divider
          onSelect={setSwipeNavigation}
        />
        <ToggleRow
          title="Collapse Bottom Bar"
          icon="platterBottomArrowDown"
          tint={settingsTint.bottomBar}
          value={collapses}
          onChange={setCollapsesBottomBar}
        />
      </Group>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", minHeight: settingsLayout.rowMinHeight, paddingHorizontal: settingsLayout.rowInset },
  fill: { flex: 1 },
});
