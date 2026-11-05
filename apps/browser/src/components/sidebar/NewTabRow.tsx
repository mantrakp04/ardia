import { memo, useState } from "react";
import { Animated, Pressable, View, type LayoutChangeEvent } from "react-native";
import { Button, ContextMenuArea, radius, space, Symbol, Text, useHover } from "../ui";
import { layout, useTheme } from "../ui/theme";
import { HoverSlot } from "../ui/HoverSlot";
import { newTab } from "../../state/tabs/actions";
import { useCleanedCount } from "../../state/sidebar/hooks";
import { openNewTabInSplit } from "../../state/splits/actions";
import { openOverflowMenu, openSidebarMenu } from "../../state/sidebar/menus";
import { toggleNewTabBar } from "../../state/omnibox/newTabBar";
import { modifiersOf } from "../../lib/keys";
import { useClipped, useShift, type ClipSource } from "./EntryMotion";
import { TAB_ROW, useSidebarTokens } from "./tokens";
import { SidebarRowLabel } from "./SidebarRow";

const CLIPPED = { marginTop: -layout.rowGap, paddingTop: layout.rowGap, overflow: "hidden" } as const;
const NEW_TAB_LABEL_X = 30;
const CLEANED_HINT_RIGHT = 30;
const CLEANED_HINT_GAP = space.m;
const BUTTONS_ROOM = TAB_ROW.trailing + TAB_ROW.closeSlot + TAB_ROW.trailing;
const MEASURE_TEXT = { alignSelf: "flex-start" } as const;
const HINT = { marginRight: space.xxs } as const;
const MEASURE_OFFSCREEN = { position: "absolute", width: 1000, height: 0, overflow: "hidden", opacity: 0 } as const;

export const NewTabRow = memo(function NewTabRow({ windowId, shift = null, clip = null }: { windowId: string; shift?: Animated.Value | null; clip?: ClipSource | null }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const cleaned = useCleanedCount(windowId);
  const { hovered, hoverProps } = useHover();
  const [moved, movedRef] = useShift(shift);
  const [movedButtons, movedButtonsRef] = useShift(shift);
  const clipped = useClipped(clip);
  const [widths, setWidths] = useState({ row: 0, label: 0, hint: 0 });
  const measure = (key: keyof typeof widths) => (e: LayoutChangeEvent) => {
    const width = Math.ceil(e.nativeEvent.layout.width);
    setWidths((w) => (w[key] === width ? w : { ...w, [key]: width }));
  };
  const hint = `${cleaned} cleaned`;
  const hintFits = widths.hint > 0 && NEW_TAB_LABEL_X + widths.label + CLEANED_HINT_GAP + widths.hint <= widths.row - CLEANED_HINT_RIGHT;
  return (
    <View {...hoverProps} onLayout={measure("row")} style={[{ flexDirection: "row", alignItems: "center" }, clipped ? CLIPPED : null]}>
      <View pointerEvents="none" style={MEASURE_OFFSCREEN}>
        <Text lines={1} style={MEASURE_TEXT} onLayout={measure("label")}>
          New Tab
        </Text>
        {cleaned > 0 ? (
          <Text lines={1} size="caption" style={MEASURE_TEXT} onLayout={measure("hint")}>
            {hint}
          </Text>
        ) : null}
      </View>
      <ContextMenuArea style={{ flex: 1 }} onContextMenu={() => void openSidebarMenu(windowId)}>
        <Pressable
          style={{ flex: 1 }}
          onPress={(e) => {
            if (modifiersOf(e).altKey) openNewTabInSplit(windowId);
            else toggleNewTabBar(windowId) || newTab(windowId, { newTabCommand: true });
          }}
        >
          {({ pressed }) => (
            <View
              {...moved}
              ref={movedRef}
              style={[
                {
                  height: layout.rowHeight,
                  borderRadius: radius.chrome,
                  flexDirection: "row",
                  alignItems: "center",
                  paddingLeft: TAB_ROW.contentLeft,
                  paddingRight: BUTTONS_ROOM,
                  backgroundColor: pressed ? theme.tabPressed : hovered ? theme.tabHover : undefined,
                },
                moved.style as object,
              ]}
            >
              <Symbol name="plus" size={13} weight="medium" color={tokens.newTabIcon} style={{ width: 16, height: 16 }} />
              <SidebarRowLabel text="New Tab" color={tokens.newTabLabel} />
            </View>
          )}
        </Pressable>
      </ContextMenuArea>
      <View {...movedButtons} ref={movedButtonsRef} style={[{ position: "absolute", right: TAB_ROW.trailing, flexDirection: "row", alignItems: "center" }, movedButtons.style as object]}>
        <HoverSlot hovered={hovered && cleaned > 0 && hintFits} width={0} hover={
            <Text size="caption" tone="textTertiary" style={HINT}>
              {hint}
            </Text>
          }
        />
        <Button variant="icon"
          icon="chevron.down"
          size="s"
          weight="semibold"
          color={hovered ? theme.textSecondary : theme.textTertiary}
          tooltip="Open and recently closed tabs"
          onPress={() => void openOverflowMenu(windowId)}
        />
      </View>
    </View>
  );
});
