import { memo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../ui/theme";
import { Symbol, useHover, weight } from "../ui";
import { SIDEBAR_TYPE } from "./tokens";
import { closeAllTabs } from "../../state/sidebar/clearTabs";
import { tidyPins } from "../../state/sidebar/tidyPinsUi";

const CLEAR_DIVIDER_HEIGHT = 16;
const PADDING = 9;
const SPACED_TOP = 7;

type DividerProps = { windowId: string; profileId: string; spaced: boolean; clear: boolean; tidy: boolean };

export const ClearDivider = memo(function ClearDivider({ windowId, profileId, spaced, clear, tidy }: DividerProps) {
  const theme = useTheme();
  const { hovered: shown, hoverProps } = useHover();
  const [actionsWidth, setActionsWidth] = useState(0);
  const [lineWidth, setLineWidth] = useState(0);
  return (
    <View
      {...hoverProps}
      onLayout={(e) => setLineWidth(Math.max(0, e.nativeEvent.layout.width - 2 * PADDING))}
      style={{
        height: CLEAR_DIVIDER_HEIGHT,
        marginTop: spaced ? SPACED_TOP : 0,
        marginBottom: spaced ? SPACED_TOP : 0,
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: PADDING,
        paddingRight: PADDING,
      }}
    >
      <View style={{ flex: 1, height: 1, marginRight: shown ? actionsWidth : 0, overflow: "hidden" }}>
        {lineWidth ? (
          <View style={{ position: "absolute", left: 0, top: -1, width: lineWidth, height: 2, borderBottomWidth: 1, borderStyle: "dashed", borderColor: theme.divider }} />
        ) : null}
      </View>
      <View
        onLayout={(e) => setActionsWidth(e.nativeEvent.layout.width)}
        style={{ position: "absolute", right: PADDING, top: 0, bottom: 0, flexDirection: "row", alignItems: "center", opacity: shown ? 1 : 0 }}
      >
        {tidy ? <DividerButton title="Tidy" symbol="sparkles" iconWidth={10} label="Tidy pinned tabs" onPress={() => tidyPins(windowId, profileId)} /> : null}
        {tidy && clear ? <View style={{ width: 1, height: 9, marginLeft: 8, backgroundColor: theme.divider }} /> : null}
        {clear ? <DividerButton title="Clear" symbol="arrow.down" iconWidth={8} label="Clear unpinned tabs" onPress={() => closeAllTabs(windowId)} /> : null}
      </View>
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
          const color = pressed ? theme.textSecondary : hovered ? theme.textPrimary : theme.textTertiary;
          return (
            <View style={{ height: CLEAR_DIVIDER_HEIGHT, flexDirection: "row", alignItems: "center", paddingLeft: 8 }}>
              <Symbol name={symbol} size={9} weight="semibold" color={color} style={{ width: iconWidth, height: 11, marginRight: 3 }} />
              <Text style={{ fontSize: SIDEBAR_TYPE.divider, fontWeight: weight.medium, color }}>{title}</Text>
            </View>
          );
        }}
      </Pressable>
    </View>
  );
}
