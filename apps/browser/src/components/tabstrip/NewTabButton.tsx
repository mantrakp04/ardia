import { useEffect, useMemo, useRef } from "react";
import { Animated } from "react-native";
import type { ClickModifiers } from "../../lib/keys";
import { toggleNewTabBar } from "../../state/omnibox/newTabBar";
import { openOverflowMenu, openSidebarMenu } from "../../state/sidebar/menus";
import { openNewTabInSplit } from "../../state/splits/actions";
import { newTab } from "../../state/tabs/actions";
import { noteTabStripMenu } from "../../state/telemetry/usage";
import { Button, type IconPalette } from "../ui";
import { useTheme } from "../ui/theme";
import { radius } from "../ui/tokens";
import type { DragGeometry } from "./stripGroups";
import { registerSlot } from "./stripReorder";
import { ITEM_HEIGHT, ITEM_TOP, NEW_TAB_ICON, OVERFLOW_BUTTON_WIDTH, TAB_RADIUS } from "./tokens";

const NEW_TAB_HIT = { width: ITEM_HEIGHT, height: ITEM_HEIGHT, plateX: 0, plateY: 0, box: ITEM_HEIGHT, radius: TAB_RADIUS };
const OVERFLOW_HIT = { width: OVERFLOW_BUTTON_WIDTH, height: ITEM_HEIGHT, plateX: 0, plateY: (ITEM_HEIGHT - OVERFLOW_BUTTON_WIDTH) / 2, box: OVERFLOW_BUTTON_WIDTH, radius: radius.toolbar };
const OVERFLOW_ICON = 10;

export function openTabStripMenu(windowId: string) {
  noteTabStripMenu("tabs");
  void openSidebarMenu(windowId);
}

export function NewTabButton({ windowId, geometry }: { windowId: string; geometry: DragGeometry }) {
  const theme = useTheme();
  const palette = useMemo<IconPalette>(
    () => ({ icon: theme.textSecondary, iconDisabled: theme.iconDisabled, hover: theme.tabHover, pressed: theme.tabPressed }),
    [theme.textSecondary, theme.iconDisabled, theme.tabHover, theme.tabPressed],
  );
  const overflowPalette = useMemo<IconPalette>(() => ({ ...palette, icon: theme.textTertiary }), [palette, theme.textTertiary]);
  const shift = useRef(new Animated.Value(0)).current;
  const latest = useRef(geometry);
  latest.current = geometry;
  useEffect(() => registerSlot(() => latest.current, () => latest.current.slots.length, shift), []);
  const open = (modifiers: ClickModifiers) => {
    if (modifiers.altKey) openNewTabInSplit(windowId);
    else toggleNewTabBar(windowId) || newTab(windowId, { newTabCommand: true });
  };
  const openOverflow = () => {
    noteTabStripMenu("overflow");
    void openOverflowMenu(windowId);
  };
  return (
    <Animated.View style={{ marginTop: ITEM_TOP, flexDirection: "row", transform: [{ translateX: shift }] }}>
      <Button variant="icon" toolbar icon="plus" glyph={NEW_TAB_ICON} hit={NEW_TAB_HIT} palette={palette} tooltip="New Tab (⌘T) — ⌥-click to open in Split View" onPress={open} onContextMenu={() => openTabStripMenu(windowId)} />
      <Button variant="icon" toolbar icon="chevron.down" glyph={OVERFLOW_ICON} weight="semibold" hit={OVERFLOW_HIT} palette={overflowPalette} tooltip="Open and recently closed tabs" onPress={openOverflow} onContextMenu={() => openTabStripMenu(windowId)} />
    </Animated.View>
  );
}
