import { Symbol } from "@ardia/shell";
import { memo } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { useHover } from "../primitives";
import { closeAllTabs } from "./menus";
import { tidyPins } from "./tidyPinsUi";

const CLEAR_DIVIDER_HEIGHT = 16;

type DividerProps = { windowId: string; profileId: string; spaced: boolean; clear: boolean; tidy: boolean };

export const ClearDivider = memo(function ClearDivider({ windowId, profileId, spaced, clear, tidy }: DividerProps) {
  const theme = useTheme();
  return (
    <View style={{ height: CLEAR_DIVIDER_HEIGHT, marginTop: spaced ? 7 : 0, flexDirection: "row", alignItems: "center", paddingLeft: 9, paddingRight: 9 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: theme.divider }} />
      {tidy ? <DividerButton title="Tidy" symbol="sparkles" iconWidth={10} label="Tidy pinned tabs" onPress={() => tidyPins(windowId, profileId)} /> : null}
      {tidy && clear ? <View style={{ width: 1, height: 9, marginLeft: 8, backgroundColor: theme.divider }} /> : null}
      {clear ? <DividerButton title="Clear" symbol="arrow.down" iconWidth={8} label="Clear unpinned tabs" onPress={() => closeAllTabs(windowId)} /> : null}
    </View>
  );
});

function DividerButton({ title, symbol, iconWidth, label, onPress }: { title: string; symbol: string; iconWidth: number; label: string; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable tooltip={label} accessibilityRole="button" accessibilityLabel={label} onAccessibilityTap={onPress} onPress={onPress}>
        {({ pressed }) => {
          const color = hovered && !pressed ? theme.textPrimary : theme.textSecondary;
          return (
            <View style={{ height: CLEAR_DIVIDER_HEIGHT, flexDirection: "row", alignItems: "center", paddingLeft: 8 }}>
              <Symbol name={symbol} size={9} weight="bold" color={color} style={{ width: iconWidth, height: 11, marginRight: 3 }} />
              <Text style={{ fontSize: 10, fontWeight: "600", color }}>{title}</Text>
            </View>
          );
        }}
      </Pressable>
    </View>
  );
}
