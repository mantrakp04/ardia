import { useInterfaceMetrics, scaleInterfaceStyle } from "../ui/interfaceSize";
import { scaleMetrics } from "../../lib/interfaceMetrics";
import { useMemo } from "react";
import { useContext } from "react";
import { Animated, View } from "react-native";
import { useIsActiveTab, usePageProfileId, useTab, useWindowId } from "../../state/browser/hooks";
import { useShownTabIdFor } from "../../state/tabs/topStrip";
import { TabIcon } from "../sidebar/TabIcon";
import { Divider, FadeLabel, Symbol, useHover } from "../ui";
import { surfaceTheme, ThemeContext, useTheme } from "../ui/theme";
import type { ToolbarPalette } from "../ui/toolbarColors";
import { font, space } from "../ui/tokens";
import { FloatingStrip } from "./context";
import { SelectedTab } from "./SelectedTab";
import { dragGeometry, type DragGeometry } from "./stripGroups";
import { ItemRow, useWebsiteBand } from "./TabChip";
import { CHIP_LABEL_GAP, CHIP_PAD, GAP, TOP_STRIP_HEIGHT } from "./tokens";
import { useStripDrag } from "./useStripDrag";
import { useStripCardHover } from "./StripHoverCard";
import { TabPressArea } from "../sidebar/TabPressArea";
import { tabTitle } from "../../state/browser/model";

export function SplitChip({ tabIds, width, geometry, from, group }: { tabIds: string[]; width: number; geometry: DragGeometry; from: number; group: string | null }) {
  const interfaceScale = useInterfaceMetrics().factor;
  const { GAP, TOP_STRIP_HEIGHT } = useMemo(() => ({ GAP: scaleMetrics(BASE_INTERFACE_METRICS.GAP, interfaceScale), TOP_STRIP_HEIGHT: scaleMetrics(BASE_INTERFACE_METRICS.TOP_STRIP_HEIGHT, interfaceScale) }), [interfaceScale]);
  const onTint = useTheme();
  const windowId = useWindowId();
  const profileId = usePageProfileId();
  const focusedId = useShownTabIdFor(windowId, profileId);
  const active = tabIds.includes(focusedId);
  const theme = active ? surfaceTheme(onTint) : onTint;
  const { band, palette } = useWebsiteBand(active ? focusedId : tabIds[0]!);
  const floating = useContext(FloatingStrip);
  const ink = active && !floating && palette.background ? palette : null;
  const { hovered, hoverProps } = useHover();
  const drag = useStripDrag({ tabId: null, ids: () => tabIds, pinned: false, groupId: group, geometry, from, width, gap: GAP, axis: "x" });
  return (
    <ThemeContext.Provider value={theme}>
      <Animated.View ref={drag.ref} {...drag.panHandlers} mouseDownCanMoveWindow={false} style={{ ...drag.style, zIndex: drag.dragging ? 10 : active ? 1 : 0 }}>
        <View {...hoverProps} style={{ width, height: TOP_STRIP_HEIGHT }}>
          {active && <SelectedTab width={width} band={band} opaque={drag.dragging} />}
          <ItemRow hovered={hovered && !active} pressed={false} padded={false}>
            {tabIds.map((id, i) => (
              <SplitPart key={id} tabId={id} first={i === 0} last={i === tabIds.length - 1} ink={ink} />
            ))}
          </ItemRow>
        </View>
      </Animated.View>
    </ThemeContext.Provider>
  );
}

const NO_SLOTS = dragGeometry([], GAP);

const PART_FILL = { flex: 1 } as const;

function SplitPart({ tabId, first, last, ink }: { tabId: string; first: boolean; last: boolean; ink: ToolbarPalette | null }) {
  const interfaceScale = useInterfaceMetrics().factor;
  const { PART_FILL, CHIP_PAD, SPLIT_GLYPH, SPLIT_DIVIDER_LENGTH, SPLIT_DIVIDER_GAP, CHIP_LABEL_GAP } = useMemo(() => ({ PART_FILL: scaleInterfaceStyle(BASE_INTERFACE_METRICS.PART_FILL, interfaceScale), CHIP_PAD: scaleMetrics(BASE_INTERFACE_METRICS.CHIP_PAD, interfaceScale), SPLIT_GLYPH: scaleMetrics(BASE_INTERFACE_METRICS.SPLIT_GLYPH, interfaceScale), SPLIT_DIVIDER_LENGTH: scaleMetrics(BASE_INTERFACE_METRICS.SPLIT_DIVIDER_LENGTH, interfaceScale), SPLIT_DIVIDER_GAP: scaleMetrics(BASE_INTERFACE_METRICS.SPLIT_DIVIDER_GAP, interfaceScale), CHIP_LABEL_GAP: scaleMetrics(BASE_INTERFACE_METRICS.CHIP_LABEL_GAP, interfaceScale) }), [interfaceScale]);
  const theme = useTheme();
  const windowId = useWindowId();
  const tab = useTab(tabId);
  const focused = useIsActiveTab(tabId);
  const drag = useStripDrag({ tabId, ids: () => [tabId], pinned: false, groupId: null, geometry: NO_SLOTS, from: -1, width: 0, gap: 0, axis: "y" });
  const card = useStripCardHover(windowId, tabId, drag.ref);
  if (!tab) return null;
  return (
    <Animated.View ref={drag.ref} {...drag.panHandlers} {...card} style={{ flex: 1, alignSelf: "stretch", opacity: drag.style.opacity }}>
      <TabPressArea
        windowId={windowId}
        tab={tab}
        style={PART_FILL}
        pressStyle={{ flex: 1, flexDirection: "row", alignItems: "center", paddingLeft: first ? CHIP_PAD.left : 0, paddingRight: last ? CHIP_PAD.right : 0 }}
      >
        {first ? (
          <Symbol name="rectangle.split.2x1" size={11} color={ink?.secondary ?? theme.textSecondary} style={SPLIT_GLYPH} />
        ) : (
          <Divider vertical length={SPLIT_DIVIDER_LENGTH} color={ink?.divider ?? theme.textTertiary} style={SPLIT_DIVIDER_GAP} />
        )}
        <View pointerEvents="none">
          <TabIcon url={tab.url} favicon={tab.favicon} icon={tab.customIcon} compact profileId={tab.profileId} />
        </View>
        <FadeLabel text={tabTitle(tab)} fontSize={font.small.fontSize} color={ink ? (focused ? ink.text : ink.secondary) : focused ? theme.tabSelectedText : theme.textTab} style={{ flex: 1, height: 16 * interfaceScale, marginLeft: CHIP_LABEL_GAP }} />
      </TabPressArea>
    </Animated.View>
  );
}

const SPLIT_GLYPH = { width: 14, height: 16, marginRight: space.xs } as const;
const SPLIT_DIVIDER_LENGTH = 16;
const SPLIT_DIVIDER_GAP = { marginHorizontal: space.s } as const;

const BASE_INTERFACE_METRICS = { GAP, TOP_STRIP_HEIGHT, PART_FILL, CHIP_PAD, SPLIT_GLYPH, SPLIT_DIVIDER_LENGTH, SPLIT_DIVIDER_GAP, CHIP_LABEL_GAP };
