import { useEffect } from "react";
import { BackHandler, StatusBar, useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BrowsingScreen } from "./components/browsing/BrowsingScreen";
import { SearchTray } from "./components/search/SearchTray";
import { StartScreen } from "./components/search/StartScreen";
import { ink } from "./components/ui";
import { useOpenPage } from "./state/browse/hooks";
import { handleSystemBack } from "./state/browse/store";
import { handleSearchBack } from "./state/search/store";

export default function App() {
  const page = useOpenPage();
  const dark = useColorScheme() === "dark";
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => handleSearchBack() || handleSystemBack());
    return () => subscription.remove();
  }, []);
  return (
    <SafeAreaProvider>
      <StatusBar translucent backgroundColor={ink.clear} barStyle={dark ? "light-content" : "dark-content"} />
      {page ? <BrowsingScreen page={page} /> : <StartScreen />}
      <SearchTray />
    </SafeAreaProvider>
  );
}
