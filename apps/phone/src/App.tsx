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
import { useTheme, DEFAULT_PROFILE_COLOR, FullSheet, OverlayHost, PROFILE_PRESETS, ProfileLookContext, Shade, SheetBackground } from "./components/ui";
import { useLook } from "./state/sync/hooks";
import { startSettingsSources } from "./state/settings/actions";
import { startSync } from "./state/sync/actions";
import { useSettingsNav } from "./state/settings/hooks";
import { useOnboarding } from "./state/onboarding/hooks";
import { bootApp, useBoot } from "./state/app/boot";
import { startLinks } from "./state/links/links";
import { useBaseSystemBars, useSystemBars } from "./state/app/systemBars";
import { useSearchOpen } from "./state/search/hooks";
import { useSheet, useSurface } from "./state/browse/hooks";
import { appBecameActive, appWillResignActive, closeArchive, goBackToStartIfEmpty, startBrowser } from "./state/browse/store";
import { handleSystemBack, startPageUi } from "./state/page/actions";
import { VoiceSearchView } from "./components/search/VoiceSearchView";
import { useVoicePresented } from "./state/voice/store";
import { useSharedValue } from "react-native-reanimated";
import { closeSettings } from "./state/settings/nav";
import { frontSheet } from "./state/settings/settingsRules";
import { inkLayer, lightStatusIcons } from "./lib/statusInk";
import { reportLaunch, startTelemetry } from "./state/telemetry/telemetry";
import { useIncognito, useSelectedTab } from "./state/tabs/hooks";

export default function App() {
  useState(() =>
    bootApp(() => {
      startTelemetry();
      startBrowser();
      startPageUi();
      startSettingsSources();
      startSync();
      startLinks();
    }),
  );
  const ready = useBoot((s) => s.ready);
  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => void reportLaunch(Date.now()));
    return () => cancelAnimationFrame(frame);
  }, [ready]);
  const dark = useColorScheme() === "dark";
  const look = useLook(PROFILE_PRESETS, DEFAULT_PROFILE_COLOR);
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
        <ProfileLookContext.Provider value={look}>
          <OverlayHost>{ready ? <Surfaces /> : null}</OverlayHost>
        </ProfileLookContext.Provider>
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
  const voice = useVoicePresented();
  const sheetProgress = useSharedValue(0);
  const front = frontSheet(settingsOpen, sheet);
  const theme = useTheme();
  const incognito = useIncognito();
  const layer = inkLayer({ onboarding, voice, sheet: front !== null, searching, surface });
  const lightIcons = lightStatusIcons(layer, { cover: theme.backdrop[0], surface: theme.surface, deck: theme.backdrop[0], incognito });
  useEffect(goBackToStartIfEmpty, [tab, surface]);
  return (
    <>
      <SheetBackground progress={sheetProgress}>
        <Layer covered={onboarding || voice} muted={front !== null}>
          <Shade shaded={searching}>
            {surface === "browsing" && tab ? <BrowsingScreen tab={tab} /> : null}
            {surface === "deck" ? <TabDeck /> : null}
            {surface === "start" ? <StartScreen /> : null}
          </Shade>
          <SearchTray />
        </Layer>
      </SheetBackground>
      <Layer covered={onboarding || voice}>
        <FullSheet sheet={front} progress={sheetProgress} onDismiss={front === "settings" ? closeSettings : closeArchive}>
          {(shown) => (shown === "settings" ? <SettingsView /> : shown === "archive" ? <ArchiveView /> : <SpacesView />)}
        </FullSheet>
      </Layer>
      <Layer covered={onboarding}>
        <VoiceSearchView />
      </Layer>
      <OnboardingView />
      <ToastHost />
      {lightIcons !== null ? <LayerInk key={layer} light={lightIcons} /> : null}
    </>
  );
}

function LayerInk({ light }: { light: boolean }) {
  useSystemBars(light);
  return null;
}

const COVER_SETTLE_MS = 450;

function Layer({ covered, muted = false, children }: { covered: boolean; muted?: boolean; children: ReactNode }) {
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
      pointerEvents={covered || muted ? "none" : "box-none"}
      collapsable={false}
      importantForAccessibility={covered || muted ? "no-hide-descendants" : "auto"}
      accessibilityElementsHidden={covered || muted}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 }, gone: { display: "none" } });
