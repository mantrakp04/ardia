import { useEffect, useState } from "react";
import { AppState, BackHandler, StatusBar, StyleSheet, useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BrowsingScreen } from "./components/browsing/BrowsingScreen";
import { SearchTray } from "./components/search/SearchTray";
import { StartScreen } from "./components/search/StartScreen";
import { ArchiveView } from "./components/tabs/ArchiveView";
import { TabDeck } from "./components/tabs/TabDeck";
import { ink } from "./components/ui";
import { useSheet, useSurface } from "./state/browse/hooks";
import { appBecameActive, appWillResignActive, goBackToStartIfEmpty, startBrowser } from "./state/browse/store";
import { handleSystemBack, startPageUi } from "./state/page/actions";
import { useSelectedTab } from "./state/tabs/hooks";

export default function App() {
  useState(() => {
    startBrowser();
    startPageUi();
  });
  const surface = useSurface();
  const sheet = useSheet();
  const tab = useSelectedTab();
  const dark = useColorScheme() === "dark";
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
        <StatusBar translucent backgroundColor={ink.clear} barStyle={dark ? "light-content" : "dark-content"} />
        {surface === "browsing" && tab ? <BrowsingScreen tab={tab} /> : null}
        {surface === "deck" ? <TabDeck /> : null}
        {surface === "start" ? <StartScreen /> : null}
        <SearchTray />
        {sheet === "archive" ? <ArchiveView /> : null}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
