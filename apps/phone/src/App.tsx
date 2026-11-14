import { useEffect, useState, type ReactNode } from "react";
import { AppState, BackHandler, StyleSheet, useColorScheme, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BrowsingScreen } from "./components/browsing/BrowsingScreen";
import { SearchTray } from "./components/search/SearchTray";
import { StartScreen } from "./components/search/StartScreen";
import { ArchiveView } from "./components/tabs/ArchiveView";
import { TabDeck } from "./components/tabs/TabDeck";
import { OnboardingView } from "./components/onboarding/OnboardingView";
import { SettingsView } from "./components/settings/SettingsView";
import { SpacesView } from "./components/sync/SpacesView";
import { ToastHost } from "./components/toasts/ToastHost";
import { PROFILE_COLORS, ThemeColorContext, type ProfileColor } from "./components/ui";
import { useLookColor } from "./state/sync/hooks";
import { startSettingsSources } from "./state/settings/actions";
import { startSync } from "./state/sync/actions";
import { useSettingsNav } from "./state/settings/hooks";
import { useOnboarding } from "./state/onboarding/hooks";
import { useBaseSystemBars } from "./state/app/systemBars";
import { useSheet, useSurface } from "./state/browse/hooks";
import { appBecameActive, appWillResignActive, goBackToStartIfEmpty, startBrowser } from "./state/browse/store";
import { handleSystemBack, startPageUi } from "./state/page/actions";
import { useSelectedTab } from "./state/tabs/hooks";

const SWATCHES = (Object.keys(PROFILE_COLORS) as ProfileColor[]).map((key) => ({ key, hex: PROFILE_COLORS[key].swatch }));

export default function App() {
  useState(() => {
    startBrowser();
    startPageUi();
    startSettingsSources();
    startSync();
  });
  const surface = useSurface();
  const sheet = useSheet();
  const tab = useSelectedTab();
  const dark = useColorScheme() === "dark";
  const color = useLookColor(SWATCHES, "plum");
  const settingsOpen = useSettingsNav((s) => s.open);
  const onboarding = useOnboarding((s) => s.showing);
  useBaseSystemBars(dark);
  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", handleSystemBack);
    const state = AppState.addEventListener("change", (next) => (next === "active" ? appBecameActive() : appWillResignActive()));
    return () => {
      back.remove();
      state.remove();
    };
  }, []);
  useEffect(goBackToStartIfEmpty, [tab, surface]);
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ThemeColorContext.Provider value={color}>
          <Layer covered={sheet !== null || settingsOpen || onboarding}>
            {surface === "browsing" && tab ? <BrowsingScreen tab={tab} /> : null}
            {surface === "deck" ? <TabDeck /> : null}
            {surface === "start" ? <StartScreen /> : null}
            <SearchTray />
          </Layer>
          <Layer covered={settingsOpen || onboarding}>
            {sheet === "archive" ? <ArchiveView /> : null}
            {sheet === "spaces" ? <SpacesView /> : null}
          </Layer>
          <Layer covered={onboarding}>
            <SettingsView />
          </Layer>
          <OnboardingView />
          <ToastHost />
        </ThemeColorContext.Provider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Layer({ covered, children }: { covered: boolean; children: ReactNode }) {
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
      collapsable={false}
      importantForAccessibility={covered ? "no-hide-descendants" : "auto"}
      accessibilityElementsHidden={covered}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
