import { memo, useState, type ReactNode } from "react";
import { Animated, Image, Pressable, View } from "react-native";
import { useTheme } from "../ui/theme";
import { ContextMenuArea, Divider, Symbol, Text, useHover } from "../ui";
import { useSidebarScale } from "./scale";
import { HoverSlot } from "../ui/HoverSlot";
import { closeAllTabs } from "../../state/sidebar/clearTabs";
import { tidy as tidyTabs } from "../../state/sidebar/tidyUi";
import { openSidebarMenu } from "../../state/sidebar/menus";
import { PINNED_FOLD_TITLES, togglePinnedFold } from "../../state/sidebar/pinnedFold";

const BROOM = require("../../../assets/tidy-broom.png");

const DIA_DIVIDER_SIDE = 6.5;
const CLEAR_DIVIDER_HEIGHT = 2 * DIA_DIVIDER_SIDE + 1;
const ACTION_DIVIDER_LENGTH = 9;
const CHEVRON = { box: 10, glyph: 8 } as const;
const ACTION_GLYPH = { size: 9, height: 11 } as const;

type PinnedFold = { collapsed: boolean; open: Animated.Value };

type DividerProps = { windowId: string; profileId: string; lift: number; clear: boolean; tidy: boolean; pinned: PinnedFold | null };

export const ClearDivider = memo(function ClearDivider({ windowId, profileId, lift, clear, tidy, pinned }: DividerProps) {
  const theme = useTheme();
  const m = useSidebarScale();
  const padding = m.tabRow.contentLeft;
  const { hovered: shown, hoverProps } = useHover();
  const [lineWidth, setLineWidth] = useState(0);
  const foldShown = !!pinned && (shown || pinned.collapsed);
  const actions = tidy || clear;
  return (
    <ContextMenuArea onContextMenu={() => void openSidebarMenu(windowId)}>
      <View
        {...hoverProps}
        onLayout={(e) => setLineWidth(Math.max(0, e.nativeEvent.layout.width - 2 * padding))}
        style={{
          height: m.px(CLEAR_DIVIDER_HEIGHT),
          marginTop: -lift,
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: padding,
          paddingRight: padding,
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
                    icon={(color) => <Image source={BROOM} style={{ width: m.px(11), height: m.px(11), marginRight: m.space.xs, tintColor: color }} />}
                  />
                ) : null}
                {tidy && clear ? <Divider vertical thick length={m.px(ACTION_DIVIDER_LENGTH)} style={{ marginLeft: m.space.m }} /> : null}
                {clear ? (
                  <DividerButton
                    title="Clear"
                    label="Clear unpinned tabs"
                    onPress={() => closeAllTabs(windowId)}
                    icon={(color) => <Symbol name="arrow.down" size={m.px(ACTION_GLYPH.size)} weight="semibold" color={color} style={{ width: m.px(8), height: m.px(ACTION_GLYPH.height), marginRight: m.space.xs }} />}
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
  const m = useSidebarScale();
  const { hovered, hoverProps } = useHover();
  const label = pinned.collapsed ? PINNED_FOLD_TITLES.expand : PINNED_FOLD_TITLES.collapse;
  const rotate = pinned.open.interpolate({ inputRange: [0, 1], outputRange: ["-90deg", "0deg"] });
  return (
    <View {...hoverProps}>
      <Pressable tooltip={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: !pinned.collapsed }} onAccessibilityTap={onPress} onPress={onPress}>
        {({ pressed }) => {
          const color = pressed ? theme.textSecondary : hovered ? theme.textPrimary : theme.textTertiary;
          return (
            <View style={{ height: m.px(CLEAR_DIVIDER_HEIGHT), flexDirection: "row", alignItems: "center", paddingRight: m.space.m }}>
              <Animated.View style={{ width: m.px(CHEVRON.box), height: m.px(CHEVRON.box), marginRight: m.space.xs, alignItems: "center", justifyContent: "center", transform: [{ rotate }] }}>
                <Symbol name="chevron.down" size={m.px(CHEVRON.glyph)} weight="semibold" color={color} style={{ width: m.px(CHEVRON.box), height: m.px(CHEVRON.box) }} />
              </Animated.View>
              <Text size="tiny" weight="medium" color={color} style={{ fontSize: m.font.tiny }}>
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
  const m = useSidebarScale();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable tooltip={label} accessibilityRole="button" accessibilityLabel={label} onAccessibilityTap={onPress} onPress={onPress}>
        {({ pressed }) => {
          const color = pressed ? theme.textSecondary : hovered ? theme.textPrimary : theme.textTertiary;
          return (
            <View style={{ height: m.px(CLEAR_DIVIDER_HEIGHT), flexDirection: "row", alignItems: "center", paddingLeft: m.space.m }}>
              {icon(color)}
              <Text size="tiny" weight="medium" color={color} style={{ fontSize: m.font.tiny }}>
                {title}
              </Text>
            </View>
          );
        }}
      </Pressable>
    </View>
  );
}
