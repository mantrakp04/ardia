import { View } from "react-native";
import { useTheme } from "../../ui/theme";
import { useSettings, useTabLayout } from "../../../state/browser/hooks";
import { chooseTabLayout, updateSettings } from "../../../state/settings/actions";
import { peekModifierOf, splitLinkModifierOf, type PeekModifier, type Settings, type SplitLinkModifier } from "../../../state/settings/settings";
import { liquidGlass } from "../../ui/Glass";
import { PopUp, Toggle } from "../../ui";
import { Group, Row, SectionHeader } from "../Form";
import { PictureChoice } from "../PictureChoice";
import { setting } from "../settingsIndex";
import { useSettingsColors } from "../useSettingsColors";
import { CleanUpRow } from "./CleanUpRow";

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

const NEW_TAB_BUTTON: { value: Settings["newTabButtonPosition"]; title: string }[] = [
  { value: "bottom", title: "At the bottom" },
  { value: "top", title: "At the top" },
];

export function TabsPane() {
  const settings = useSettings((s) => s);
  const update = updateSettings;
  const toggle = (key: keyof Settings, anchor: string) => (
    <Row key={key} anchor={anchor}>
      <Toggle value={!!settings[key]} onChange={(v) => update({ [key]: v })} />
    </Row>
  );
  const top = useTabLayout() === "top";

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
        {liquidGlass && toggle("pinnedTabIconRing", "tabs.pinnedTabIconRing")}
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
        {!top && (
          <Row anchor="tabs.newTabButtonPosition">
            <PopUp value={settings.newTabButtonPosition} options={NEW_TAB_BUTTON} onChange={(newTabButtonPosition) => update({ newTabButtonPosition })} minWidth={190} />
          </Row>
        )}
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
      <Group of="tabs.cleanUp">
        <CleanUpRow hours={settings.cleanUpInactiveTabsAfterHours} />
      </Group>
    </View>
  );
}

function LayoutChoice({ layout, title, selected }: { layout: "sidebar" | "top"; title: string; selected: boolean }) {
  const theme = useTheme();
  const look = useSettingsColors();
  return (
    <PictureChoice
      title={title}
      selected={selected}
      onPress={() => chooseTabLayout(layout)}
      gap={8}
      frame={{ height: 104, borderRadius: 10, padding: 8, backgroundColor: look.miniWindow, flexDirection: layout === "sidebar" ? "row" : "column", gap: 5 }}
    >
      {layout === "sidebar" ? (
        <View style={{ width: "26%", gap: 4, paddingTop: 10 }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ height: 7, borderRadius: 3, backgroundColor: i === 1 ? theme.formAccent : look.miniBar }} />
          ))}
        </View>
      ) : (
        <View style={{ height: 10, flexDirection: "row", gap: 4, paddingLeft: 26 }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ flex: 1, borderRadius: 3, backgroundColor: i === 1 ? theme.formAccent : look.miniBar }} />
          ))}
        </View>
      )}
      <View style={{ flex: 1, borderRadius: 5, backgroundColor: look.miniPage }} />
    </PictureChoice>
  );
}
