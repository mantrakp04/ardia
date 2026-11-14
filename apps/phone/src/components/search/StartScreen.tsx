import { useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { newIncognitoTab, newRegularTab, newTab, openArchive, reopenLastClosed, showDeck } from "../../state/browse/store";
import { useSearchOpen } from "../../state/search/hooks";
import { useCanReopen, useHasTabs, useIncognito } from "../../state/tabs/hooks";
import { ArdiaLogo, Backdrop, browseLayout, deckCenterFromBottom, Menu, tabsInk, tabsLayout, useTheme, type MenuItem } from "../ui";
import { openSettings } from "../../state/settings/hooks";
import { DeckBar } from "../tabs/DeckBar";

const BAR_RESERVE = 58;

export function StartScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const trayUp = useSearchOpen();
  const hasTabs = useHasTabs();
  const incognito = useIncognito();
  const canReopen = useCanReopen();
  const { width } = useWindowDimensions();
  const [menu, setMenu] = useState(false);
  const center = deckCenterFromBottom(insets.bottom);
  const items: MenuItem[] = incognito
    ? [
        { label: "New Tab", icon: "plus", onPress: newRegularTab },
        { label: "New Incognito Tab", icon: "eyes", onPress: newTab },
      ]
    : [
        { label: "New Incognito Tab", icon: "eyes", onPress: newIncognitoTab },
        ...(canReopen ? [{ label: "Reopen Closed Tab", icon: "arrowUturnBackward" as const, onPress: reopenLastClosed }] : []),
      ];
  return (
    <View style={StyleSheet.absoluteFill}>
      {incognito ? <Backdrop colors={tabsInk.incognitoBackdrop} /> : <Backdrop colors={theme.start.colors} diagonal={theme.start.diagonal} />}
      <View style={[styles.logo, { paddingBottom: BAR_RESERVE / 2, opacity: trayUp ? 0 : 1 }]} pointerEvents="none">
        <ArdiaLogo width={browseLayout.logoWidth} />
      </View>
      {trayUp ? null : (
        <View style={[styles.deck, { bottom: center - browseLayout.hitTarget / 2, paddingHorizontal: tabsLayout.barSideInset - 4 }]}>
          <DeckBar
            leading={hasTabs ? { icon: "squareOnSquare", label: "Tabs", onPress: showDeck } : { icon: "archivebox", label: "Archive", onPress: openArchive }}
            plusLabel={incognito ? "New Incognito Tab" : "New Tab"}
            onPlus={newTab}
            onPlusMenu={() => setMenu(true)}
            onSettings={() => openSettings()}
          />
        </View>
      )}
      {menu && !trayUp ? (
        <Menu
          items={items}
          place={{ bottom: center + tabsLayout.barPlus.height, left: (width - tabsLayout.menuWidth) / 2, width: tabsLayout.menuWidth }}
          onDismiss={() => setMenu(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  logo: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  deck: { position: "absolute", left: 0, right: 0 },
});
