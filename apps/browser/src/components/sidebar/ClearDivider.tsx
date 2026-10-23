import { Symbol } from "@ardia/shell";
import { createContext, memo, useContext, useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { useHover } from "../primitives";
import { closeAllTabs } from "./menus";

const CLEAR_DIVIDER_HEIGHT = 16;
const SidebarHoverContext = createContext(false);

export function SidebarHover({ width, children }: { width: number; children: ReactNode }) {
  const { hovered, hoverProps } = useHover();
  return (
    <SidebarHoverContext.Provider value={hovered}>
      <View {...hoverProps} style={{ width, height: "100%" }}>{children}</View>
    </SidebarHoverContext.Provider>
  );
}

export const ClearDivider = memo(function ClearDivider({ windowId, current, spaced }: { windowId: string; current: boolean; spaced: boolean }) {
  const theme = useTheme();
  const sidebarHovered = useContext(SidebarHoverContext);
  const [focused, setFocused] = useState(false);
  const { hovered, hoverProps } = useHover();
  useEffect(() => {
    if (!current) setFocused(false);
  }, [current]);
  const visible = current && (sidebarHovered || focused);
  const clear = () => current && closeAllTabs(windowId);
  return (
    <View style={{ height: CLEAR_DIVIDER_HEIGHT, marginVertical: spaced ? 7 : 0, flexDirection: "row", alignItems: "center", paddingLeft: 9, paddingRight: 9 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: theme.divider }} />
      <View {...hoverProps} accessibilityElementsHidden={!current} pointerEvents={visible ? "auto" : "none"} style={visible ? undefined : { position: "absolute", right: 9 }}>
        <Pressable focusable={current} accessible={current} disabled={!current} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} tooltip={visible ? "Clear unpinned tabs" : undefined} accessibilityRole="button" accessibilityLabel="Clear unpinned tabs" onAccessibilityTap={clear} onPress={clear}>
          {({ pressed }) => {
            const color = hovered && !pressed ? theme.textPrimary : theme.textTertiary;
            return (
              <View style={{ height: CLEAR_DIVIDER_HEIGHT, flexDirection: "row", alignItems: "center", paddingLeft: 8, opacity: visible ? 1 : 0 }}>
                <Symbol name="arrow.down" size={9} weight="bold" color={color} style={{ width: 8, height: 11, marginRight: 3 }} />
                <Text style={{ fontSize: 9, fontWeight: "500", color }}>Clear</Text>
              </View>
            );
          }}
        </Pressable>
      </View>
    </View>
  );
});
