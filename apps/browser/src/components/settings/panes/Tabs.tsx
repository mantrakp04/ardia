import { useState } from "react";
import { View } from "react-native";
import { useTheme } from "../../ui/theme";
import { useSettings, useTabLayout } from "../../../state/browser/hooks";
import { chooseTabLayout, updateSettings } from "../../../state/settings/actions";
import { splitLinkModifierOf, type PeekModifier, type Settings, type SplitLinkModifier } from "../../../state/settings/settings";
import { Box, Button, Checkbox, DialogActions, DialogTitle, PopUp, Sheet, space, Text, TextField, type Option } from "../../ui";
import { durationMinutes, durationParts, type DurationUnit } from "../../../lib/time";
import { cleanUpChoices, CUSTOM_CLEAN_UP, DAILY_CLEAN_UP_MINUTES } from "../../../state/settings/cleanUpAfter";
import { closeSettingsSheet, showSettingsSheet } from "../../../state/settings/sheet";
import { Group, Row, SectionHeader, SettingToggle } from "../Form";
import { MiniWindow } from "../MiniWindow";
import { PictureChoice } from "../PictureChoice";
import { setting, type SettingId } from "../settingsIndex";
import { useSettingsColors } from "../useSettingsColors";

const PEEK_WITH: { value: PeekModifier; title: string }[] = [
  { value: "shift", title: "⇧-click" },
  { value: "alt", title: "⌥-click" },
  { value: "off", title: "Off" },
];

const SPLIT_WITH: { value: SplitLinkModifier; title: string }[] = [
  { value: "altShift", title: "⌥⇧-click" },
  { value: "alt", title: "⌥-click" },
];

const withNote = (anchor: SettingId, note: string | null) => (note ? `${setting(anchor).description ?? ""} ${note}`.trim() : undefined);

function LinkKeys() {
  const peekWith = useSettings((s) => s.peekModifier);
  const splitWith = useSettings(splitLinkModifierOf);
  const peekOptions = PEEK_WITH.map((o) => (o.value === "alt" && splitWith === "alt" ? { ...o, title: "⌥-click (split view moves to ⌥⇧-click)" } : o));
  const splitOptions = SPLIT_WITH.map((o) => (o.value === "alt" && peekWith === "alt" ? { ...o, title: "⌥-click (Peek moves to ⇧-click)" } : o));
  return (
    <Group>
      <SettingToggle anchor="tabs.peekLinksToOtherSites" />
      <Row anchor="tabs.peekModifier" description={withNote("tabs.peekModifier", splitWith === "alt" ? "⌥-click opens a split now: choosing it here moves split view back to ⌥⇧-click." : null)}>
        <PopUp value={peekWith} options={peekOptions} onChange={(peekModifier) => updateSettings({ peekModifier })} />
      </Row>
      <Row anchor="tabs.splitLinkModifier" description={withNote("tabs.splitLinkModifier", peekWith === "alt" ? "⌥-click peeks now: choosing it here moves Peek back to ⇧-click." : null)}>
        <PopUp value={splitWith} options={splitOptions} onChange={(splitLinkModifier) => updateSettings({ splitLinkModifier })} />
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

const DURATION_UNITS: Option<DurationUnit>[] = [
  { value: "minutes", title: "Minutes" },
  { value: "hours", title: "Hours" },
  { value: "days", title: "Days" },
];

export function TabsPane() {
  const newTabOpens = useSettings((s) => s.newTabOpens);
  const newTabPosition = useSettings((s) => s.newTabPosition);
  const newTabButtonPosition = useSettings((s) => s.newTabButtonPosition);
  const cleanUpMinutes = useSettings((s) => s.cleanUpInactiveTabsAfterMinutes);
  const top = useTabLayout() === "top";

  return (
    <View>
      <SectionHeader anchor="tabs.layout" description={null} />
      <Box gap="xl">
        <Box row gap="xl">
          <LayoutChoice layout="sidebar" title="Tab layout in the sidebar" selected={!top} />
          <LayoutChoice layout="top" title="Tab layout across the top of the window" selected={top} />
        </Box>
        <Group>
        <SettingToggle anchor="tabs.hideToolbarWhileScrolling" />
        <SettingToggle anchor="tabs.showSidebarButton" />
        <SettingToggle anchor="tabs.showClearButton" />
        <SettingToggle anchor="tabs.balancedTopApps" />
        <SettingToggle anchor="tabs.fadeUnloadedTabs" />
        </Group>
      </Box>

      <SectionHeader title="General" />
      <Group>
        <Row anchor="tabs.newTabOpens">
          <PopUp
            value={newTabOpens}
            options={[
              { value: "page", title: "New Tab Page" },
              { value: "commandBar", title: "Command Bar" },
            ]}
            onChange={(v) => updateSettings({ newTabOpens: v })}
            minWidth={160}
          />
        </Row>
        <Row anchor="tabs.newTabPosition">
          <PopUp value={newTabPosition} options={top ? NEW_TABS_ACROSS : NEW_TABS_DOWN} onChange={(v) => updateSettings({ newTabPosition: v })} minWidth={190} />
        </Row>
        <Row anchor="tabs.newTabButtonPosition">
          <PopUp value={newTabButtonPosition} options={NEW_TAB_BUTTON} onChange={(v) => updateSettings({ newTabButtonPosition: v })} minWidth={190} />
        </Row>
        <SettingToggle anchor="tabs.shareTabsAcrossWindows" />
        <SettingToggle anchor="tabs.warnBeforeClosingLastTab" />
        <SettingToggle anchor="tabs.tabReorderHaptics" />
        <SettingToggle anchor="tabs.extendWebsiteColor" />
        <SettingToggle anchor="tabs.sidebarMediaControls" />
        <SettingToggle anchor="tabs.autoPictureInPicture" />
        <SettingToggle anchor="tabs.videoUpscaling" />
      </Group>

      <SectionHeader title="Links" />
      <LinkKeys />

      <SectionHeader title="Tab groups" />
      <Group>
        <SettingToggle anchor="tabs.warnBeforeClosingTabGroup" />
        <SettingToggle anchor="tabs.cmdClickCreatesTabGroup" />
        <SettingToggle anchor="tabs.optShiftClickOpensInGroup" />
        <SettingToggle anchor="tabs.autoGroupMeetingTabs" />
      </Group>

      <SectionHeader
        title="Clean up"
        description="Closes tabs you haven't used (and duplicates) automatically, like the tab menu's Clean Up Daily. Pinned, playing and selected tabs stay; cleaned tabs are listed under Recently Cleaned."
      />
      <CleanUpRow minutes={cleanUpMinutes} />
    </View>
  );
}

function CleanUpRow({ minutes }: { minutes: number | null }) {
  const shown = minutes ?? DAILY_CLEAN_UP_MINUTES;
  return (
    <Group>
      <Row anchor="tabs.cleanUp" description={null} title={<Checkbox value={minutes !== null} onChange={(v) => updateSettings({ cleanUpInactiveTabsAfterMinutes: v ? DAILY_CLEAN_UP_MINUTES : null })} label="Clean up tabs I haven't used in:" />}>
        <PopUp
          value={String(shown)}
          options={cleanUpChoices(shown)}
          disabled={minutes === null}
          onChange={(v) => (v === CUSTOM_CLEAN_UP ? showSettingsSheet(<CustomCleanUpSheet minutes={shown} />) : updateSettings({ cleanUpInactiveTabsAfterMinutes: Number(v) }))}
        />
      </Row>
    </Group>
  );
}

function CustomCleanUpSheet({ minutes }: { minutes: number }) {
  const start = durationParts(minutes);
  const [amount, setAmount] = useState(String(start.amount));
  const [unit, setUnit] = useState<DurationUnit>(start.unit);
  const [invalid, setInvalid] = useState(false);
  const save = () => {
    const chosen = durationMinutes(amount, unit);
    if (chosen === null) return setInvalid(true);
    updateSettings({ cleanUpInactiveTabsAfterMinutes: chosen });
    closeSettingsSheet();
  };
  return (
    <Sheet size="s" onClose={closeSettingsSheet}>
      <DialogTitle subtitle="Clean up tabs I haven't used in:">Custom Clean Up Time</DialogTitle>
      <Box row gap="m" style={FIELDS}>
        <TextField value={amount} onChangeText={(text) => { setAmount(text); setInvalid(false); }} onSubmit={save} onEscape={closeSettingsSheet} autoFocus selectOnFocus width={80} />
        <PopUp value={unit} options={DURATION_UNITS} onChange={(next) => { setUnit(next); setInvalid(false); }} minWidth={110} />
      </Box>
      {invalid && (
        <Text size="caption" tone="destructive" style={ERROR}>
          Enter a number above zero, up to 365 days.
        </Text>
      )}
      <DialogActions>
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title="Save" kind="primary" onPress={save} />
      </DialogActions>
    </Sheet>
  );
}

const FIELDS = { marginTop: space.l, alignItems: "center" } as const;
const ERROR = { marginTop: space.ml } as const;

function LayoutChoice({ layout, title, selected }: { layout: "sidebar" | "top"; title: string; selected: boolean }) {
  const theme = useTheme();
  const look = useSettingsColors();
  return (
    <PictureChoice title={title} selected={selected} onPress={() => chooseTabLayout(layout)} size="l">
      <MiniWindow
        size="l"
        layout={layout === "sidebar" ? "side" : "top"}
        bars={layout === "sidebar" ? 4 : 3}
        accentBar={1}
        look={{ window: look.miniWindow, bar: look.miniBar, page: look.miniPage, accent: theme.formAccent }}
      />
    </PictureChoice>
  );
}
