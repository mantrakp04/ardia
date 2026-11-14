import { useEffect, useMemo, useRef } from "react";
import { Animated } from "react-native";
import type { ClickModifiers } from "../../lib/keys";
import { toggleNewTabBar } from "../../state/omnibox/newTabBar";
import { openNewTabInSplit } from "../../state/splits/actions";
import { splitViewAvailable } from "../../state/splits/splits";
import { newTab } from "../../state/tabs/actions";
import { Button, type IconPalette } from "../ui";
import { perLook } from "../ui/tokens";
import { useTheme } from "../ui/theme";
import type { DragGeometry } from "./stripGroups";
import { registerSlot } from "./stripReorder";
import { ITEM_HEIGHT, ITEM_TOP, NEW_TAB_ICON, tabRadius } from "./tokens";
import { keyText } from "../../state/commands/keyText";

const NEW_TAB_HIT = perLook(() => ({ width: ITEM_HEIGHT, height: ITEM_HEIGHT, plateX: 0, plateY: 0, box: ITEM_HEIGHT, radius: tabRadius() }));

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
    if (modifiers.altKey && splitViewAvailable) openNewTabInSplit(windowId);
    else toggleNewTabBar(windowId) || newTab(windowId, { newTabCommand: true });
  };
  return (
    <Animated.View style={{ marginTop: ITEM_TOP, transform: [{ translateX: shift }] }}>
      <Button variant="icon" toolbar icon="plus" glyph={NEW_TAB_ICON} hit={NEW_TAB_HIT()} palette={palette} tooltip={splitViewAvailable ? `New Tab (${keyText("⌘T")}) — ${keyText("⌥")}-click to open in Split View` : `New Tab (${keyText("⌘T")})`} onPress={open} />
    </Animated.View>
  );
}
