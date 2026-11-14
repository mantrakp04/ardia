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
import { OverlayHost, PROFILE_COLORS, Shade, ThemeColorContext, type ProfileColor } from "./components/ui";
import { useLookColor } from "./state/sync/hooks";
import { startSettingsSources } from "./state/settings/actions";
import { startSync } from "./state/sync/actions";
import { useSettingsNav } from "./state/settings/hooks";
import { useOnboarding } from "./state/onboarding/hooks";
import { bootApp, useBoot } from "./state/app/boot";
import { startLinks } from "./state/links/links";
import { useBaseSystemBars } from "./state/app/systemBars";
import { useSearchOpen } from "./state/search/hooks";
import { useSheet, useSurface } from "./state/browse/hooks";
import { appBecameActive, appWillResignActive, goBackToStartIfEmpty, startBrowser } from "./state/browse/store";
import { handleSystemBack, startPageUi } from "./state/page/actions";
import { useSelectedTab } from "./state/tabs/hooks";

const SWATCHES = (Object.keys(PROFILE_COLORS) as ProfileColor[]).map((key) => ({ key, hex: PROFILE_COLORS[key].swatch }));

export default function App() {
  useState(() =>
    bootApp(() => {
      startBrowser();
      startPageUi();
      startSettingsSources();
      startSync();
      startLinks();
    }),
  );
  const ready = useBoot((s) => s.ready);
  const dark = useColorScheme() === "dark";
  const color = useLookColor(SWATCHES, "plum");
  useBaseSystemBars(dark);
  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", handleSystemBack);
    const state = AppState.addEventListener("change", (next) => (next === "active" ? appBecameActive() : appWillResignActive()));
    return () => {
      back.remove();
      state.remove();
    };
  }, []);
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ThemeColorContext.Provider value={color}>
          <OverlayHost>{ready ? <Surfaces /> : null}</OverlayHost>
        </ThemeColorContext.Provider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Surfaces() {
  const surface = useSurface();
  const sheet = useSheet();
  const tab = useSelectedTab();
  const settingsOpen = useSettingsNav((s) => s.open);
  const onboarding = useOnboarding((s) => s.showing);
  const searching = useSearchOpen();
  useEffect(goBackToStartIfEmpty, [tab, surface]);
  return (
    <>
      <Layer covered={sheet !== null || settingsOpen || onboarding}>
        <Shade shaded={searching}>
          {surface === "browsing" && tab ? <BrowsingScreen tab={tab} /> : null}
          {surface === "deck" ? <TabDeck /> : null}
          {surface === "start" ? <StartScreen /> : null}
        </Shade>
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
    </>
  );
}

const COVER_SETTLE_MS = 450;

function Layer({ covered, children }: { covered: boolean; children: ReactNode }) {
  const [gone, setGone] = useState(covered);
  useEffect(() => {
    if (!covered) {
      setGone(false);
      return;
    }
    const settle = setTimeout(() => setGone(true), COVER_SETTLE_MS);
    return () => clearTimeout(settle);
  }, [covered]);
  return (
    <View
      style={[StyleSheet.absoluteFill, gone ? styles.gone : null]}
      pointerEvents={covered ? "none" : "box-none"}
      collapsable={false}
      importantForAccessibility={covered ? "no-hide-descendants" : "auto"}
      accessibilityElementsHidden={covered}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 }, gone: { display: "none" } });
