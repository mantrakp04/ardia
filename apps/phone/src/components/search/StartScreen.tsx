import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSearchOpen } from "../../state/search/hooks";
import { presentSearch } from "../../state/search/store";
import { ArdiaLogo, Backdrop, browseLayout, capsule, deckCenterFromBottom, PressScale, Symbol, useTheme } from "../ui";

const BAR_RESERVE = 96;

export function StartScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const trayUp = useSearchOpen();
  const center = deckCenterFromBottom(insets.bottom);
  const plus = browseLayout.plusCapsule;
  return (
    <View style={StyleSheet.absoluteFill}>
      <Backdrop colors={theme.backdrop} />
      <View style={[styles.logo, { paddingBottom: BAR_RESERVE / 2, opacity: trayUp ? 0 : 1 }]} pointerEvents="none">
        <ArdiaLogo width={browseLayout.logoWidth} />
      </View>
      {trayUp ? null : (
        <View style={[styles.deck, { bottom: center - browseLayout.hitTarget / 2 }]}>
          <PressScale
            label="New Tab"
            onPress={() => presentSearch("start")}
            style={[
              styles.plus,
              { width: plus.width, height: plus.height, borderRadius: capsule(plus.height), backgroundColor: theme.plusFill, borderColor: theme.controlEdge },
            ]}
          >
            <Symbol name="plus" size={20} color={theme.label} />
          </PressScale>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  logo: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  deck: { position: "absolute", left: 0, right: 0, height: browseLayout.hitTarget, alignItems: "center", justifyContent: "center" },
  plus: { alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
});
