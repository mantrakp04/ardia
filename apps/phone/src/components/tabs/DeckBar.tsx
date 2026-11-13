import { StyleSheet, View } from "react-native";
import { browseLayout, capsule, PressScale, Symbol, tabsLayout, useTheme, type SymbolName } from "../ui";

type Props = { leading: { icon: SymbolName; label: string; onPress: () => void } | null; plusLabel: string; onPlus: () => void; onPlusMenu: () => void };

export function DeckBar({ leading, plusLabel, onPlus, onPlusMenu }: Props) {
  const theme = useTheme();
  const plus = tabsLayout.barPlus;
  return (
    <View style={styles.row}>
      <View style={styles.side}>
        {leading ? (
          <PressScale label={leading.label} onPress={leading.onPress} style={styles.hit}>
            <View style={[styles.circle, { backgroundColor: theme.deckControl, borderColor: theme.controlEdge }]}>
              <Symbol name={leading.icon} size={17} color={theme.secondaryLabel} />
            </View>
          </PressScale>
        ) : null}
      </View>
      <PressScale
        label={plusLabel}
        hint="Touch and hold for more options"
        onPress={onPlus}
        onLongPress={onPlusMenu}
        style={[styles.plus, { width: plus.width, height: plus.height, borderRadius: capsule(plus.height), backgroundColor: theme.deckControl, borderColor: theme.controlEdge }]}
      >
        <Symbol name="plus" size={22} color={theme.label} />
      </PressScale>
      <View style={styles.side} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", height: browseLayout.hitTarget },
  side: { flex: 1, alignItems: "flex-start" },
  hit: { width: browseLayout.hitTarget, height: browseLayout.hitTarget, alignItems: "center", justifyContent: "center" },
  circle: {
    width: tabsLayout.barCircle,
    height: tabsLayout.barCircle,
    borderRadius: capsule(tabsLayout.barCircle),
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  plus: { alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
});
