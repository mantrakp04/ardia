import { memo, useEffect, useMemo, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { markHoverProps } from "../../lib/hoverMarks";
import { useTheme } from "../ui/theme";
import { Symbol, useHover, weight } from "../ui";
import { SIDEBAR_TYPE } from "./tokens";
import { closeAllTabs } from "../../state/sidebar/clearTabs";
import { tidyPins } from "../../state/sidebar/tidyPinsUi";

const CLEAR_DIVIDER_HEIGHT = 16;
const PADDING = 9;

const hoveredSidebars = new Set<string>();
const hoverListeners = new Set<() => void>();

function setSidebarHovered(windowId: string, hovered: boolean) {
  if (hovered === hoveredSidebars.has(windowId)) return;
  if (hovered) hoveredSidebars.add(windowId);
  else hoveredSidebars.delete(windowId);
  for (const listener of hoverListeners) listener();
}

const subscribeSidebarHover = (listener: () => void) => {
  hoverListeners.add(listener);
  return () => void hoverListeners.delete(listener);
};

export function useSidebarHoverProps(windowId: string) {
  const props = useMemo(() => markHoverProps({ onMouseEnter: () => setSidebarHovered(windowId, true), onMouseLeave: () => setSidebarHovered(windowId, false) }), [windowId]);
  useEffect(() => () => setSidebarHovered(windowId, false), [windowId]);
  return props;
}

const useSidebarHovered = (windowId: string) => useSyncExternalStore(subscribeSidebarHover, () => hoveredSidebars.has(windowId));

type DividerProps = { windowId: string; profileId: string; spaced: boolean; clear: boolean; tidy: boolean };

export const ClearDivider = memo(function ClearDivider({ windowId, profileId, spaced, clear, tidy }: DividerProps) {
  const theme = useTheme();
  const shown = useSidebarHovered(windowId);
  return (
    <View style={{ height: CLEAR_DIVIDER_HEIGHT, marginTop: spaced ? 7 : 0, flexDirection: "row", alignItems: "center", paddingLeft: PADDING, paddingRight: PADDING }}>
      <View style={{ flex: 1, height: 1, backgroundColor: theme.divider }} />
      <View>
        <View style={{ position: "absolute", left: 0, right: 0, top: (CLEAR_DIVIDER_HEIGHT - 1) / 2, height: 1, backgroundColor: theme.divider, opacity: shown ? 0 : 1 }} />
        <View style={{ flexDirection: "row", alignItems: "center", opacity: shown ? 1 : 0 }}>
          {tidy ? <DividerButton title="Tidy" symbol="sparkles" iconWidth={10} label="Tidy pinned tabs" onPress={() => tidyPins(windowId, profileId)} /> : null}
          {tidy && clear ? <View style={{ width: 1, height: 9, marginLeft: 8, backgroundColor: theme.divider }} /> : null}
          {clear ? <DividerButton title="Clear" symbol="arrow.down" iconWidth={8} label="Clear unpinned tabs" onPress={() => closeAllTabs(windowId)} /> : null}
        </View>
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
