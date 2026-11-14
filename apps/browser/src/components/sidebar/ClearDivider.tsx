import { memo, useState, type ReactNode } from "react";
import { Animated, Image, Pressable, View } from "react-native";
import { useTheme } from "../ui/theme";
import { ContextMenuArea, Divider, space, Symbol, Text, useHover } from "../ui";
import { TAB_ROW } from "./tokens";
import { HoverSlot } from "../ui/HoverSlot";
import { closeAllTabs } from "../../state/sidebar/clearTabs";
import { tidy as tidyTabs } from "../../state/sidebar/tidyUi";
import { openSidebarMenu } from "../../state/sidebar/menus";
import { PINNED_FOLD_TITLES, togglePinnedFold } from "../../state/sidebar/pinnedFold";

const BROOM = require("../../../assets/tidy-broom.png");

const DIA_DIVIDER_SIDE = 6.5;
const CLEAR_DIVIDER_HEIGHT = 2 * DIA_DIVIDER_SIDE + 1;
const PADDING = TAB_ROW.contentLeft;
const ACTIONS_DIVIDER = { marginLeft: space.m } as const;

type PinnedFold = { collapsed: boolean; open: Animated.Value };

type DividerProps = { windowId: string; profileId: string; lift: number; clear: boolean; tidy: boolean; pinned: PinnedFold | null };

export const ClearDivider = memo(function ClearDivider({ windowId, profileId, lift, clear, tidy, pinned }: DividerProps) {
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
          marginTop: -lift,
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
                {tidy ? (
                  <DividerButton
                    title="Tidy"
                    label="Tidy Tabs"
                    onPress={() => tidyTabs(windowId, "tabs", profileId)}
                    icon={(color) => <Image source={BROOM} style={{ width: 11, height: 11, marginRight: space.xs, tintColor: color }} />}
                  />
                ) : null}
                {tidy && clear ? <Divider vertical thick length={9} style={ACTIONS_DIVIDER} /> : null}
                {clear ? (
                  <DividerButton
                    title="Clear"
                    label="Clear unpinned tabs"
                    onPress={() => closeAllTabs(windowId)}
                    icon={(color) => <Symbol name="arrow.down" size={9} weight="semibold" color={color} style={{ width: 8, height: 11, marginRight: space.xs }} />}
                  />
                ) : null}
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
            <View style={{ height: CLEAR_DIVIDER_HEIGHT, flexDirection: "row", alignItems: "center", paddingRight: space.m }}>
              <Animated.View style={{ width: 10, height: 10, marginRight: space.xs, alignItems: "center", justifyContent: "center", transform: [{ rotate }] }}>
                <Symbol name="chevron.down" size={8} weight="semibold" color={color} style={{ width: 10, height: 10 }} />
              </Animated.View>
              <Text size="tiny" weight="medium" color={color}>
                Pinned
              </Text>
            </View>
          );
        }}
      </Pressable>
    </View>
  );
}

function DividerButton({ title, label, onPress, icon }: { title: string; label: string; onPress: () => void; icon: (color: string) => ReactNode }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable tooltip={label} accessibilityRole="button" accessibilityLabel={label} onAccessibilityTap={onPress} onPress={onPress}>
        {({ pressed }) => {
          const color = pressed ? theme.textSecondary : hovered ? theme.textPrimary : theme.textTertiary;
          return (
            <View style={{ height: CLEAR_DIVIDER_HEIGHT, flexDirection: "row", alignItems: "center", paddingLeft: space.m }}>
              {icon(color)}
              <Text size="tiny" weight="medium" color={color}>
                {title}
              </Text>
            </View>
          );
        }}
      </Pressable>
    </View>
  );
}
