import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { newTab, openArchive, showDeck } from "../../state/browse/store";
import { useSearchOpen } from "../../state/search/hooks";
import { useHasTabs, useIncognito } from "../../state/tabs/hooks";
import { ArdiaLogo, Backdrop, browseLayout, deckCenterFromBottom, tabsInk, tabsLayout, useTheme } from "../ui";
import { DeckBar } from "../tabs/DeckBar";

const BAR_RESERVE = 58;

export function StartScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const trayUp = useSearchOpen();
  const hasTabs = useHasTabs();
  const incognito = useIncognito();
  const center = deckCenterFromBottom(insets.bottom);
  return (
    <View style={StyleSheet.absoluteFill}>
      <Backdrop colors={incognito ? tabsInk.incognitoBackdrop : theme.backdrop} />
      <View style={[styles.logo, { paddingBottom: BAR_RESERVE / 2, opacity: trayUp ? 0 : 1 }]} pointerEvents="none">
        <ArdiaLogo width={browseLayout.logoWidth} />
      </View>
      {trayUp ? null : (
        <View style={[styles.deck, { bottom: center - browseLayout.hitTarget / 2, paddingHorizontal: tabsLayout.barSideInset - 4 }]}>
          <DeckBar
            leading={hasTabs ? { icon: "squareOnSquare", label: "Tabs", onPress: showDeck } : { icon: "archivebox", label: "Archive", onPress: openArchive }}
            plusLabel={incognito ? "New Incognito Tab" : "New Tab"}
            onPlus={newTab}
            onPlusMenu={newTab}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  logo: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  deck: { position: "absolute", left: 0, right: 0 },
});
