import { Symbol, VisualEffect, WindowDragRegion, Button, font, Toggle, useHover, weight } from "../ui";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../ui/theme";
import { useProfile, useSettings } from "../../state/browser/hooks";
import { updateSettings } from "../../state/settings/actions";
import { trackSettingsSection } from "../../state/telemetry/track";
import { preparePane, usePaneLoaded } from "../../state/settings/paneData";
import { anchorView, clearSettingsReveal, flashSetting, settingsSectionKey, useSettingsSearch } from "../../state/settings/searchState";
import { ADVANCED_PANES, PANES, setting } from "./settingsIndex";
import { SettingsPaneContext } from "./Form";
import { SettingsSearchField, SettingsSearchResults } from "./SettingsSearch";
import { AdvancedPane } from "./panes/Advanced";
import { AppearancePane } from "./panes/Appearance";
import { CalendarPane } from "./panes/Calendar";
import { GeneralPane } from "./panes/General";
import { LiveFoldersPane } from "./panes/LiveFolders";
import { ExtensionsPane } from "./panes/Extensions";
import { PasswordsPane } from "./panes/Passwords";
import { AutofillPane } from "./panes/Autofill";
import { PrivacyPane } from "./panes/Privacy";
import { ProfileDetailsPane, ProfilesPane } from "./panes/Profiles";
import { SearchPane } from "./panes/Search";
import { EnginesPane } from "./panes/Engines";
import { ShortcutsPane } from "./panes/Shortcuts";
import { SyncPane } from "./panes/Sync";
import { TabsPane } from "./panes/Tabs";
import { useSettingsSheet } from "../../state/settings/sheet";
import { goToSettingsPane, settingsBack, settingsForward, useSettingsNav, type SettingsPlace } from "../../state/settings/settingsWindows";
import { settingsProfileFor } from "../../state/extensions/store";
import { useSettingsColors } from "./useSettingsColors";


const SIDEBAR = 214;
const TOOLBAR = 52;
const HOLD_CAP_MS = 250;
const REVEAL_MARGIN = 16;

const shownKey = (s: SettingsPlace) => `${s.pane}:${s.profileId ?? ""}:${s.detail ?? ""}`;

function useShownPane(): SettingsPlace | null {
  const nav = useSettingsNav();
  const target = { pane: nav.pane, profileId: nav.profileId, detail: nav.detail };
  const key = shownKey(target);
  const loaded = usePaneLoaded(nav.pane, nav.profileId);
  const [expired, setExpired] = useState<string | null>(null);
  const [last, setLast] = useState<SettingsPlace | null>(null);
  const ready = loaded || expired === key;
  useEffect(() => {
    if (ready) return setLast(target);
    void preparePane(target.pane, target.profileId);
    const timer = setTimeout(() => setExpired(key), HOLD_CAP_MS);
    return () => clearTimeout(timer);
  }, [key, ready]);
  return ready ? target : last;
}

function usePrefetchAllPanes(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => {
      for (const p of PANES) void preparePane(p.id, null);
    }, 0);
    return () => clearTimeout(timer);
  }, [enabled]);
}

export function SettingsWindow() {
  const theme = useTheme();
  const look = useSettingsColors();
  const nav = useSettingsNav();
  const shown = useShownPane();
  usePrefetchAllPanes(!!shown);
  const profileName = useProfile(shown?.profileId, (p) => p?.name);
  const title = shown ? (shown.pane === "profiles" && profileName ? profileName : PANES.find((p) => p.id === shown.pane)!.title) : "";
  const sheet = useSettingsSheet((s) => s.sheet);
  useEffect(() => trackSettingsSection(nav.pane), [nav.pane]);
  const scroller = useRef<ScrollView>(null);
  const key = shown ? shownKey(shown) : "";
  useLayoutEffect(() => scroller.current?.scrollTo({ y: 0, animated: false }), [key]);
  const content = useRef<View>(null);
  const scrollTop = useRef(0);
  const viewport = useRef(0);
  const query = useSettingsSearch((s) => s.query);
  const reveal = useSettingsSearch((s) => s.reveal);
  const revealPane = reveal ? setting(reveal.id).pane : null;
  const showAdvanced = useSettings((s) => s.showAdvancedSettings);
  const revealedSections = useSettingsSearch((s) => s.revealedSections);
  const panes = PANES.filter(
    (p) => showAdvanced || !ADVANCED_PANES.has(p.id) || nav.pane === p.id || revealedSections.some((k) => k.startsWith(settingsSectionKey(p.id, ""))),
  );
  const switched = useRef(key);
  useEffect(() => {
    if (!reveal) return;
    if (nav.pane !== revealPane) return void clearSettingsReveal();
    if (shown?.pane !== revealPane) return;
    const animated = switched.current === key;
    const frame = requestAnimationFrame(() => {
      const target = anchorView(reveal.id);
      const container = content.current;
      if (!target || !container) return flashSetting("");
      target.measureLayout(
        container,
        (_x, y, _w, h) => {
          const top = animated ? scrollTop.current : 0;
          const inView = y >= top + REVEAL_MARGIN && y + h <= top + viewport.current - REVEAL_MARGIN;
          if (!inView) scroller.current?.scrollTo({ y: Math.max(0, y - viewport.current / 3), animated });
          flashSetting(reveal.id);
        },
        () => flashSetting(reveal.id),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [reveal, key]);
  useEffect(() => {
    switched.current = key;
  }, [key]);

  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: look.windowFill }}>
      <View style={{ width: SIDEBAR }}>
        <VisualEffect material="sidebar" blendingMode="behindWindow" style={StyleSheet.absoluteFill} />
        <WindowDragRegion style={{ height: TOOLBAR }} />
        <SettingsSearchField />
        {query.trim() ? (
          <SettingsSearchResults query={query} />
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 12, gap: 1 }}>
            {panes.map((p) => (
              <SidebarItem key={p.id} title={p.title} icon={p.icon} selected={nav.pane === p.id} onPress={() => goToSettingsPane(p.id, settingsProfileFor(p.id, nav))} />
            ))}
          </ScrollView>
        )}
        <AdvancedToggle />
      </View>
      <View style={{ width: StyleSheet.hairlineWidth * 2, backgroundColor: look.sidebarDivider }} />
      <View style={{ flex: 1 }}>
        <View style={{ height: TOOLBAR, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 2 }}>
          <WindowDragRegion style={StyleSheet.absoluteFill} />
          <Button variant="icon" toolbar icon="chevron.left" size={13} box={28} radius={6} disabled={!nav.back.length} onPress={() => settingsBack()} tooltip="Back" />
          <Button variant="icon" toolbar icon="chevron.right" size={13} box={28} radius={6} disabled={!nav.forward.length} onPress={() => settingsForward()} tooltip="Forward" />
          <Text style={{ marginLeft: 8, ...font.heading, fontWeight: weight.semibold, color: theme.textPrimary }}>{title}</Text>
        </View>
        <ScrollView
          ref={scroller}
          scrollEventThrottle={16}
          onScroll={(e) => void (scrollTop.current = e.nativeEvent.contentOffset.y)}
          onLayout={(e) => void (viewport.current = e.nativeEvent.layout.height)}
          contentContainerStyle={{ alignItems: "center", paddingBottom: 40 }}>
          <View key={key} ref={content} collapsable={false} style={{ width: "100%", maxWidth: 600, paddingHorizontal: 24 }}>
            {shown ? (
              <SettingsPaneContext.Provider value={shown.pane}>
                <Pane {...shown} />
              </SettingsPaneContext.Provider>
            ) : null}
          </View>
        </ScrollView>
      </View>
      {sheet}
    </View>
  );
}

function Pane({ pane, profileId, detail }: SettingsPlace): ReactNode {
  switch (pane) {
    case "general":
      return <GeneralPane />;
    case "profiles":
      return profileId ? <ProfileDetailsPane profileId={profileId} /> : <ProfilesPane />;
    case "sync":
      return <SyncPane />;
    case "tabs":
      return <TabsPane />;
    case "appearance":
      return <AppearancePane />;
    case "privacy":
      return <PrivacyPane />;
    case "passwords":
      return <PasswordsPane profileId={profileId} />;
    case "autofill":
      return <AutofillPane profileId={profileId} />;
    case "extensions":
      return <ExtensionsPane profileId={profileId} detail={detail} />;
    case "search":
      return <SearchPane />;
    case "engines":
      return <EnginesPane />;
    case "shortcuts":
      return <ShortcutsPane />;
    case "liveFolders":
      return <LiveFoldersPane />;
    case "calendar":
      return <CalendarPane />;
    case "advanced":
      return <AdvancedPane />;
  }
}

function SidebarItem({ title, icon, selected, onPress }: { title: string; icon: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress}>
        <View
          style={{
            height: 30,
            borderRadius: 7,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 8,
            gap: 9,
            backgroundColor: selected ? theme.formAccent : hovered ? theme.rowHover : undefined,
          }}
        >
          <Symbol name={icon} size={13} color={selected ? theme.onAccent : theme.icon} style={{ width: 20, height: 20 }} />
          <Text style={{ ...font.body, color: selected ? theme.onAccent : theme.textPrimary }}>{title}</Text>
        </View>
      </Pressable>
    </View>
  );
}

function AdvancedToggle() {
  const theme = useTheme();
  const shown = useSettings((s) => s.showAdvancedSettings);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: theme.divider }}>
      <Text style={{ flex: 1, ...font.small, color: theme.textSecondary }}>Show advanced settings</Text>
      <Toggle value={shown} onChange={(v) => updateSettings({ showAdvancedSettings: v })} />
    </View>
  );
}
