import { useContext } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { useIsActiveTab, usePageProfileId, useTab, useWindowId } from "../../state/browser/hooks";
import { useShownTabIdFor } from "../../state/tabs/topStrip";
import { TabIcon } from "../sidebar/TabIcon";
import { FadeLabel, Symbol, useHover } from "../ui";
import { useTheme } from "../ui/theme";
import type { ToolbarPalette } from "../ui/toolbarColors";
import { font } from "../ui/tokens";
import { FloatingStrip } from "./context";
import { SelectedTab } from "./SelectedTab";
import { dragGeometry, type DragGeometry } from "./stripGroups";
import { ItemRow, useWebsiteBand } from "./TabChip";
import { CHIP_LABEL_GAP, GAP, TOP_STRIP_HEIGHT } from "./tokens";
import { useStripDrag } from "./useStripDrag";
import { TabPressArea } from "../sidebar/TabPressArea";
import { tabTitle, tabTooltip } from "../../state/browser/model";

export function SplitChip({ tabIds, width, geometry, from, group }: { tabIds: string[]; width: number; geometry: DragGeometry; from: number; group: string | null }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const profileId = usePageProfileId();
  const focusedId = useShownTabIdFor(windowId, profileId);
  const active = tabIds.includes(focusedId);
  const { band, palette } = useWebsiteBand(active ? focusedId : tabIds[0]!);
  const floating = useContext(FloatingStrip);
  const ink = active && !floating && palette.background ? palette : null;
  const { hovered, hoverProps } = useHover();
  const drag = useStripDrag({ tabId: null, ids: () => tabIds, pinned: false, groupId: group, geometry, from, width, gap: GAP, axis: "x" });
  return (
    <Animated.View ref={drag.ref} {...drag.panHandlers} mouseDownCanMoveWindow={false} style={{ ...drag.style, zIndex: drag.dragging ? 10 : active ? 1 : 0 }}>
      <View {...hoverProps} style={{ width, height: TOP_STRIP_HEIGHT }}>
        {active && <SelectedTab width={width} band={band} opaque={drag.dragging} />}
        <ItemRow hovered={hovered && !active} pressed={false}>
          <Symbol name="rectangle.split.2x1" size={11} color={ink?.secondary ?? theme.textSecondary} style={{ width: 14, height: 16, marginRight: 4 }} />
          {tabIds.map((id, i) => (
            <SplitPart key={id} tabId={id} first={i === 0} ink={ink} />
          ))}
        </ItemRow>
      </View>
    </Animated.View>
  );
}

const NO_SLOTS = dragGeometry([], GAP);

const PART_ROW = { flex: 1, flexDirection: "row", alignItems: "center" } as const;

function SplitPart({ tabId, first, ink }: { tabId: string; first: boolean; ink: ToolbarPalette | null }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const tab = useTab(tabId);
  const focused = useIsActiveTab(tabId);
  const drag = useStripDrag({ tabId, ids: () => [tabId], pinned: false, groupId: null, geometry: NO_SLOTS, from: -1, width: 0, gap: 0, axis: "y" });
  if (!tab) return null;
  return (
    <Animated.View ref={drag.ref} {...drag.panHandlers} style={{ flex: 1, flexDirection: "row", alignItems: "center", opacity: drag.style.opacity }}>
      <TabPressArea
        windowId={windowId}
        tab={tab}
        style={PART_ROW}
        pressStyle={PART_ROW}
        tooltip={tabTooltip(tab)}
        leading={first ? null : <View style={{ width: StyleSheet.hairlineWidth, height: 16, marginHorizontal: 6, backgroundColor: ink?.divider ?? theme.textTertiary }} />}
      >
        <View pointerEvents="none">
          <TabIcon url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={14} profileId={tab.profileId} />
        </View>
        <FadeLabel text={tabTitle(tab)} fontSize={font.small.fontSize} color={ink ? (focused ? ink.text : ink.secondary) : focused ? theme.tabSelectedText : theme.textTab} style={{ flex: 1, height: 16, marginLeft: CHIP_LABEL_GAP }} />
      </TabPressArea>
    </Animated.View>
  );
}
