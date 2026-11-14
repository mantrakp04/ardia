import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { noteDeckBarTop, watchDeckBar } from "../../state/toasts/store";
import type { FrostVariant } from "@ardia/phone-native";
import { browseLayout, capsule, LookFrost, PressScale, Symbol, tabsLayout, useTheme, type SymbolName } from "../ui";

export type DeckBarFrost = { source: string; variant: FrostVariant; incognito?: boolean };

type Props = {
  leading: { icon: SymbolName; label: string; onPress: () => void } | null;
  plusLabel: string;
  frost: DeckBarFrost;
  onPlus: () => void;
  onPlusMenu: () => void;
  onSettings: () => void;
};

export function DeckBar({ leading, plusLabel, frost, onPlus, onPlusMenu, onSettings }: Props) {
  const theme = useTheme();
  const plus = tabsLayout.barPlus;
  const row = useRef<View>(null);
  const measure = () => row.current?.measureInWindow((_x, y, _width, height) => noteDeckBarTop(height > 0 ? y : null));
  useEffect(() => {
    watchDeckBar(measure);
    return () => watchDeckBar(null);
  }, []);
  return (
    <View ref={row} style={styles.row} onLayout={measure}>
      <View style={styles.side}>
        {leading ? (
          <PressScale label={leading.label} onPress={leading.onPress} style={styles.hit}>
            <LookFrost {...frost} cornerRadius={circleRadius} fill={theme.deckControl} style={[styles.circle, { borderColor: theme.controlEdge }]}>
              <Symbol name={leading.icon} size={17} color={theme.secondaryLabel} />
            </LookFrost>
          </PressScale>
        ) : null}
      </View>
      <PressScale
        label={plusLabel}
        hint="Touch and hold for more options."
        onPress={onPlus}
        onLongPress={onPlusMenu}
        style={{ width: plus.width, height: plus.height }}
      >
        <LookFrost {...frost} cornerRadius={capsule(plus.height)} fill={theme.deckControl} style={[styles.plus, { borderColor: theme.controlEdge }]}>
          <Symbol name="plus" size={22} color={theme.label} />
        </LookFrost>
      </PressScale>
      <View style={[styles.side, styles.end]}>
        <PressScale label="Settings" onPress={onSettings} style={styles.hit}>
          <LookFrost {...frost} cornerRadius={circleRadius} fill={theme.deckControl} style={[styles.circle, { borderColor: theme.controlEdge }]}>
            <Symbol name="gearshape" size={17} color={theme.secondaryLabel} />
          </LookFrost>
        </PressScale>
      </View>
    </View>
  );
}

const circleRadius = capsule(tabsLayout.barCircle);

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", height: browseLayout.hitTarget },
  side: { flex: 1, alignItems: "flex-start" },
  end: { alignItems: "flex-end" },
  hit: { width: browseLayout.hitTarget, height: browseLayout.hitTarget, alignItems: "center", justifyContent: "center" },
  circle: {
    width: tabsLayout.barCircle,
    height: tabsLayout.barCircle,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  plus: { flex: 1, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
});
