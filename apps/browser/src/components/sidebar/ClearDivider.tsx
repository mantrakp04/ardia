import { memo, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { useTheme } from "../ui/theme";
import { ContextMenuArea, Symbol, useHover, weight } from "../ui";
import { SIDEBAR_TYPE } from "./tokens";
import { HoverSlot } from "../ui/HoverSlot";
import { closeAllTabs } from "../../state/sidebar/clearTabs";
import { tidyPins } from "../../state/sidebar/tidyPinsUi";
import { openSidebarMenu } from "../../state/sidebar/menus";
import { PINNED_FOLD_TITLES, togglePinnedFold } from "../../state/sidebar/pinnedFold";

const CLEAR_DIVIDER_HEIGHT = 16;
const PADDING = 9;
const SPACED_TOP = 7;

type PinnedFold = { collapsed: boolean; open: Animated.Value };

type DividerProps = { windowId: string; profileId: string; spaced: boolean; lift: number; clear: boolean; tidy: boolean; pinned: PinnedFold | null };

export const ClearDivider = memo(function ClearDivider({ windowId, profileId, spaced, lift, clear, tidy, pinned }: DividerProps) {
  const theme = useTheme();
  const { hovered: shown, hoverProps } = useHover();
  const [lineWidth, setLineWidth] = useState(0);
  const foldShown = !!pinned && (shown || pinned.collapsed);
  const actions = tidy || clear;
  return (
    <ContextMenuArea onContextMenu={() => void openSidebarMenu(windowId)}>
      <View
        {...hoverProps}
        onLayout={(e) => setLineWidth(Math.max(0, e.nativeEvent.layout.width - 2 * PADDING))}
        style={{
          height: CLEAR_DIVIDER_HEIGHT,
          marginTop: spaced ? SPACED_TOP : -lift,
          marginBottom: spaced ? SPACED_TOP : 0,
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: PADDING,
          paddingRight: PADDING,
        }}
      >
        {pinned ? <HoverSlot hovered={foldShown} width="content" reserve="hover" align="start" hover={<FoldButton pinned={pinned} onPress={() => togglePinnedFold(profileId)} />} /> : null}
        <View style={{ flex: 1, height: 1, overflow: "hidden" }}>
          {lineWidth ? (
            <View style={{ position: "absolute", left: 0, top: -1, width: lineWidth, height: 2, borderBottomWidth: 1, borderStyle: "dashed", borderColor: theme.divider }} />
          ) : null}
        </View>
        {actions ? (
          <HoverSlot
            hovered={shown}
            width="content"
            reserve="hover"
            hover={
              <>
                {tidy ? <DividerButton title="Tidy" symbol="sparkles" iconWidth={10} label="Tidy pinned tabs" onPress={() => tidyPins(windowId, profileId)} /> : null}
                {tidy && clear ? <View style={{ width: 1, height: 9, marginLeft: 8, backgroundColor: theme.divider }} /> : null}
                {clear ? <DividerButton title="Clear" symbol="arrow.down" iconWidth={8} label="Clear unpinned tabs" onPress={() => closeAllTabs(windowId)} /> : null}
              </>
            }
          />
        ) : null}
      </View>
    </ContextMenuArea>
  );
});

function FoldButton({ pinned, onPress }: { pinned: PinnedFold; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const label = pinned.collapsed ? PINNED_FOLD_TITLES.expand : PINNED_FOLD_TITLES.collapse;
  const rotate = pinned.open.interpolate({ inputRange: [0, 1], outputRange: ["-90deg", "0deg"] });
  return (
    <View {...hoverProps}>
      <Pressable tooltip={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: !pinned.collapsed }} onAccessibilityTap={onPress} onPress={onPress}>
        {({ pressed }) => {
          const color = pressed ? theme.textSecondary : hovered ? theme.textPrimary : theme.textTertiary;
          return (
            <View style={{ height: CLEAR_DIVIDER_HEIGHT, flexDirection: "row", alignItems: "center", paddingRight: 8 }}>
              <Animated.View style={{ width: 10, height: 10, marginRight: 3, alignItems: "center", justifyContent: "center", transform: [{ rotate }] }}>
                <Symbol name="chevron.down" size={8} weight="semibold" color={color} style={{ width: 10, height: 10 }} />
              </Animated.View>
              <Text style={{ fontSize: SIDEBAR_TYPE.divider, fontWeight: weight.medium, color }}>Pinned</Text>
            </View>
          );
        }}
      </Pressable>
    </View>
  );
}

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
