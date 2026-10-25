import { Symbol } from "@ardia/shell";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../../../lib/theme";
import { useBrowser } from "../../../store/browser";
import { tabLayoutOf } from "../../../store/model";
import { peekModifierOf, splitLinkModifierOf, type PeekModifier, type Settings, type SplitLinkModifier } from "../../../store/settings";
import { liquidGlass } from "../../glass";
import { Checkbox, Group, PopUp, Row, SectionHeader, Toggle, useFormColors } from "../controls";
import { setting } from "../settingsIndex";

const PEEK_WITH: { value: PeekModifier; title: string }[] = [
  { value: "shift", title: "⇧-click" },
  { value: "alt", title: "⌥-click" },
  { value: "off", title: "Off" },
];

const SPLIT_WITH: { value: SplitLinkModifier; title: string }[] = [
  { value: "altShift", title: "⌥⇧-click" },
  { value: "alt", title: "⌥-click" },
];

const withNote = (anchor: string, note: string | null) => (note ? `${setting(anchor)?.description ?? ""} ${note}`.trim() : undefined);

function LinkKeys({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  const peekWith = peekModifierOf(settings);
  const splitWith = splitLinkModifierOf(settings);
  const peekOptions = PEEK_WITH.map((o) => (o.value === "alt" && splitWith === "alt" ? { ...o, title: "⌥-click (split view moves to ⌥⇧-click)" } : o));
  const splitOptions = SPLIT_WITH.map((o) => (o.value === "alt" && peekWith === "alt" ? { ...o, title: "⌥-click (Peek moves to ⇧-click)" } : o));
  return (
    <Group>
      <Row anchor="tabs.peekModifier" description={withNote("tabs.peekModifier", splitWith === "alt" ? "⌥-click opens a split now: choosing it here moves split view back to ⌥⇧-click." : null)}>
        <PopUp value={peekWith} options={peekOptions} onChange={(peekModifier) => update({ peekModifier })} />
      </Row>
      <Row anchor="tabs.splitLinkModifier" description={withNote("tabs.splitLinkModifier", peekWith === "alt" ? "⌥-click peeks now: choosing it here moves Peek back to ⇧-click." : null)}>
        <PopUp value={splitWith} options={splitOptions} onChange={(splitLinkModifier) => update({ splitLinkModifier })} />
      </Row>
    </Group>
  );
}

const NEW_TABS_DOWN: { value: Settings["newTabPosition"]; title: string }[] = [
  { value: "bottom", title: "At the bottom" },
  { value: "top", title: "At the top" },
  { value: "nextToCurrent", title: "Below the current tab" },
];

const NEW_TABS_ACROSS: { value: Settings["newTabPosition"]; title: string }[] = [
  { value: "bottom", title: "On the right" },
  { value: "top", title: "On the left" },
  { value: "nextToCurrent", title: "Next to the current tab" },
];

const CLEAN_UP = [
  { value: "12", title: "12 hours" },
  { value: "24", title: "24 hours" },
  { value: "168", title: "7 days" },
  { value: "720", title: "30 days" },
];

export function TabsPane() {
  const settings = useBrowser((s) => s.settings);
  const update = useBrowser((s) => s.updateSettings);
  const toggle = (key: keyof Settings, anchor: string) => (
    <Row key={key} anchor={anchor}>
      <Toggle value={!!settings[key]} onChange={(v) => update({ [key]: v })} />
    </Row>
  );
  const top = useBrowser((s) => tabLayoutOf(s) === "top");

  return (
    <View>
      <SectionHeader anchor="tabs.layout" />
      <View style={{ flexDirection: "row", gap: 14 }}>
        <LayoutChoice layout="sidebar" title="Tab layout in the sidebar" selected={!top} />
        <LayoutChoice layout="top" title="Tab layout across the top of the window" selected={top} />
      </View>
      <Group style={{ marginTop: 14 }}>
        {toggle("hideToolbarWhileScrolling", "tabs.hideToolbarWhileScrolling")}
        {!top && toggle("showSidebarButton", "tabs.showSidebarButton")}
        {!top && toggle("showClearButton", "tabs.showClearButton")}
        {!top && toggle("balancedTopApps", "tabs.balancedTopApps")}
        {!top && liquidGlass && toggle("pinnedTabIconRing", "tabs.pinnedTabIconRing")}
        {toggle("fadeUnloadedTabs", "tabs.fadeUnloadedTabs")}
      </Group>

      <SectionHeader title="General" />
      <Group>
        <Row anchor="tabs.newTabOpens">
          <PopUp
            value={settings.newTabOpens}
            options={[
              { value: "page", title: "New Tab Page" },
              { value: "commandBar", title: "Command Bar" },
            ]}
            onChange={(v) => update({ newTabOpens: v })}
            minWidth={160}
          />
        </Row>
        <Row anchor="tabs.newTabPosition">
          <PopUp value={settings.newTabPosition} options={top ? NEW_TABS_ACROSS : NEW_TABS_DOWN} onChange={(newTabPosition) => update({ newTabPosition })} minWidth={190} />
        </Row>
        {toggle("shareTabsAcrossWindows", "tabs.shareTabsAcrossWindows")}
        {toggle("warnBeforeClosingLastTab", "tabs.warnBeforeClosingLastTab")}
        {toggle("tabReorderHaptics", "tabs.tabReorderHaptics")}
        {toggle("extendWebsiteColor", "tabs.extendWebsiteColor")}
        {toggle("sidebarMediaControls", "tabs.sidebarMediaControls")}
        {toggle("autoPictureInPicture", "tabs.autoPictureInPicture")}
        {toggle("videoUpscaling", "tabs.videoUpscaling")}
      </Group>

      <SectionHeader title="Links" />
      <LinkKeys settings={settings} update={update} />

      <SectionHeader title="Tab groups" />
      <Group>
        {toggle("warnBeforeClosingTabGroup", "tabs.warnBeforeClosingTabGroup")}
        {toggle("cmdClickCreatesTabGroup", "tabs.cmdClickCreatesTabGroup")}
        {toggle("optShiftClickOpensInGroup", "tabs.optShiftClickOpensInGroup")}
        {toggle("autoGroupMeetingTabs", "tabs.autoGroupMeetingTabs")}
      </Group>

      <SectionHeader
        title="Clean up"
        description="Closes tabs you haven't used (and duplicates) automatically, like the tab menu's Clean Up Daily. Pinned, playing and selected tabs stay; cleaned tabs are listed under Recently Cleaned."
      />
      <Group>
        <Row anchor="tabs.cleanUp" description={null} title={<Checkbox value={settings.cleanUpInactiveTabsAfterHours !== null} onChange={(v) => update({ cleanUpInactiveTabsAfterHours: v ? 24 : null })} label="Clean up tabs I haven't used in:" />}>
          <PopUp
            value={String(settings.cleanUpInactiveTabsAfterHours ?? 24)}
            options={CLEAN_UP}
            disabled={settings.cleanUpInactiveTabsAfterHours === null}
            onChange={(v) => update({ cleanUpInactiveTabsAfterHours: Number(v) })}
          />
        </Row>
      </Group>
    </View>
  );
}

function LayoutChoice({ layout, title, selected }: { layout: "sidebar" | "top"; title: string; selected: boolean }) {
  const theme = useTheme();
  const colors = useFormColors();
  const choose = () => {
    const s = useBrowser.getState();
    s.updateSettings({ tabLayout: layout });
    for (const w of Object.values(s.windows)) {
      if ((w.tabLayout ?? s.settings.tabLayout) !== layout) useBrowser.getState().toggleTabLayout(w.id);
    }
    useBrowser.getState().updateSettings({ tabLayout: layout });
  };
  const bar = theme.dark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.16)";
  const page = theme.dark ? "rgba(255,255,255,0.08)" : "#FFFFFF";
  return (
    <Pressable onPress={choose} style={{ flex: 1, alignItems: "center", gap: 8 }}>
      <View
        style={{
          width: "100%",
          height: 104,
          borderRadius: 10,
          padding: 8,
          borderWidth: selected ? 2.5 : 1,
          borderColor: selected ? colors.accent : colors.groupBorder,
          backgroundColor: theme.dark ? "#2A2A2C" : "#E9E9EB",
          flexDirection: layout === "sidebar" ? "row" : "column",
          gap: 5,
        }}
      >
        {layout === "sidebar" ? (
          <View style={{ width: "26%", gap: 4, paddingTop: 10 }}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={{ height: 7, borderRadius: 3, backgroundColor: i === 1 ? colors.accent : bar }} />
            ))}
          </View>
        ) : (
          <View style={{ height: 10, flexDirection: "row", gap: 4, paddingLeft: 26 }}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={{ flex: 1, borderRadius: 3, backgroundColor: i === 1 ? colors.accent : bar }} />
            ))}
          </View>
        )}
        <View style={{ flex: 1, borderRadius: 5, backgroundColor: page }} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        {selected && <Symbol name="checkmark.circle.fill" size={12} color={colors.accent} style={{ width: 14, height: 14 }} />}
        <Text style={{ fontSize: 12, color: selected ? theme.textPrimary : theme.textSecondary }}>{title}</Text>
      </View>
    </Pressable>
  );
}
