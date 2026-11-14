import { memo, useState } from "react";
import { Animated, Pressable, View, type LayoutChangeEvent } from "react-native";
import { Button, ContextMenuArea, space, Symbol, Text, useHover } from "../ui";
import { useTheme } from "../ui/theme";
import { HoverSlot } from "../ui/HoverSlot";
import { newTab } from "../../state/tabs/actions";
import { useCleanedCount } from "../../state/sidebar/hooks";
import { openNewTabInSplit } from "../../state/splits/actions";
import { openOverflowMenu, openSidebarMenu } from "../../state/sidebar/menus";
import { toggleNewTabBar } from "../../state/omnibox/newTabBar";
import { noteRowPressIn } from "../../state/sidebar/heldTabPress";
import { modifiersOf } from "../../lib/keys";
import { useClipped, useShift, type ClipSource } from "./EntryMotion";
import { useSidebarTokens } from "./tokens";
import { useSidebarScale } from "./scale";
import { SidebarRowLabel } from "./SidebarRow";
import { buttonMotion, usePressScaleMotion } from "../ui/motion";

const NEW_TAB_LABEL_X = 30;
const CLEANED_HINT_RIGHT = 30;
const CLEANED_HINT_GAP = space.m;
const PLUS_GLYPH = 13;
const MEASURE_TEXT = { alignSelf: "flex-start" } as const;
const MEASURE_OFFSCREEN = { position: "absolute", width: 1000, height: 0, overflow: "hidden", opacity: 0 } as const;

export const NewTabRow = memo(function NewTabRow({ windowId, shift = null, clip = null }: { windowId: string; shift?: Animated.Value | null; clip?: ClipSource | null }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const m = useSidebarScale();
  const cleaned = useCleanedCount(windowId);
  const { hovered, hoverProps } = useHover();
  const pressMotion = usePressScaleMotion(true, buttonMotion.iconPressScale);
  const iconScale = pressMotion.scale ? { transform: [{ scale: pressMotion.scale }] } : undefined;
  const [moved, movedRef] = useShift(shift);
  const [movedButtons, movedButtonsRef] = useShift(shift);
  const clipped = useClipped(clip);
  const [widths, setWidths] = useState({ row: 0, label: 0, hint: 0 });
  const measure = (key: keyof typeof widths) => (e: LayoutChangeEvent) => {
    const width = Math.ceil(e.nativeEvent.layout.width);
    setWidths((w) => (w[key] === width ? w : { ...w, [key]: width }));
  };
  const hint = `${cleaned} cleaned`;
  const hintFits = widths.hint > 0 && m.px(NEW_TAB_LABEL_X) + widths.label + m.px(CLEANED_HINT_GAP) + widths.hint <= widths.row - m.px(CLEANED_HINT_RIGHT);
  const buttonsRoom = m.tabRow.trailing + m.tabRow.closeSlot + m.tabRow.trailing;
  return (
    <View {...hoverProps} onLayout={measure("row")} style={[{ flexDirection: "row", alignItems: "center" }, clipped ? { marginTop: -m.rowGap, paddingTop: m.rowGap, overflow: "hidden" } : null]}>
      <View pointerEvents="none" style={MEASURE_OFFSCREEN}>
        <Text lines={1} style={[MEASURE_TEXT, { fontSize: m.font.body }]} onLayout={measure("label")}>
          New Tab
        </Text>
        {cleaned > 0 ? (
          <Text lines={1} size="caption" style={[MEASURE_TEXT, { fontSize: m.font.caption }]} onLayout={measure("hint")}>
            {hint}
          </Text>
        ) : null}
      </View>
      <ContextMenuArea style={{ flex: 1 }} onContextMenu={() => void openSidebarMenu(windowId)}>
        <Pressable
          onPressIn={() => {
            pressMotion.onPressIn?.();
            noteRowPressIn(windowId);
          }}
          onPressOut={pressMotion.onPressOut}
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
                  height: m.rowHeight,
                  borderRadius: m.radius.chrome,
                  flexDirection: "row",
                  alignItems: "center",
                  paddingLeft: m.tabRow.contentLeft,
                  paddingRight: buttonsRoom,
                  backgroundColor: pressed ? theme.tabPressed : hovered ? theme.tabHover : undefined,
                },
                moved.style as object,
              ]}
            >
              <Animated.View pointerEvents="none" style={iconScale}>
                <Symbol name="plus" size={m.px(PLUS_GLYPH)} weight="medium" color={tokens.newTabIcon} style={{ width: m.icon, height: m.icon }} />
              </Animated.View>
              <SidebarRowLabel text="New Tab" color={tokens.newTabLabel} />
            </View>
          )}
        </Pressable>
      </ContextMenuArea>
      <View {...movedButtons} ref={movedButtonsRef} style={[{ position: "absolute", right: m.tabRow.trailing, flexDirection: "row", alignItems: "center" }, movedButtons.style as object]}>
        <HoverSlot hovered={hovered && cleaned > 0 && hintFits} width={0} hover={
            <Text size="caption" tone="textTertiary" style={{ fontSize: m.font.caption, marginRight: m.space.xxs }}>
              {hint}
            </Text>
          }
        />
        <Button variant="icon"
          icon="chevron.down"
          box={m.rowButton.box}
          glyph={m.rowButton.glyph}
          weight="semibold"
          color={hovered ? theme.textSecondary : theme.textTertiary}
          tooltip="Open and recently closed tabs"
          onPress={() => void openOverflowMenu(windowId)}
        />
      </View>
    </View>
  );
});
