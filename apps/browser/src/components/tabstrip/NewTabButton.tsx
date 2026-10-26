import { useEffect, useMemo, useRef } from "react";
import { Animated } from "react-native";
import type { ClickModifiers } from "../../lib/keys";
import { toggleNewTabBar } from "../../state/omnibox/newTabBar";
import { openNewTabInSplit } from "../../state/splits/actions";
import { newTab } from "../../state/tabs/actions";
import { Button, type IconPalette } from "../ui";
import { useTheme } from "../ui/theme";
import type { DragGeometry } from "./stripGroups";
import { registerSlot } from "./stripReorder";
import { ITEM_HEIGHT, ITEM_TOP, NEW_TAB_ICON, TAB_RADIUS } from "./tokens";

export function NewTabButton({ windowId, geometry }: { windowId: string; geometry: DragGeometry }) {
  const theme = useTheme();
  const palette = useMemo<IconPalette>(
    () => ({ icon: theme.textSecondary, iconDisabled: theme.iconDisabled, hover: theme.tabHover, pressed: theme.tabPressed }),
    [theme.textSecondary, theme.iconDisabled, theme.tabHover, theme.tabPressed],
  );
  const shift = useRef(new Animated.Value(0)).current;
  const latest = useRef(geometry);
  latest.current = geometry;
  useEffect(() => registerSlot(() => latest.current, () => latest.current.slots.length, shift), []);
  const open = (modifiers: ClickModifiers) => {
    if (modifiers.altKey) openNewTabInSplit(windowId);
    else toggleNewTabBar(windowId) || newTab(windowId, { newTabCommand: true });
  };
  return (
    <Animated.View style={{ marginTop: ITEM_TOP, marginLeft: 0.5, transform: [{ translateX: shift }] }}>
      <Button variant="icon" toolbar icon="plus" size={NEW_TAB_ICON} box={ITEM_HEIGHT} radius={TAB_RADIUS} palette={palette} tooltip="New Tab (⌘T) — ⌥-click to open in Split View" onPress={open} />
    </Animated.View>
  );
}
