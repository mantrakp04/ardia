import { useContext, useRef } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { modifiersOf } from "../../lib/keys";
import { toggleMute } from "../../state/browser/actions";
import { useIsActiveTab, useSettings, useTab, useTabLive, useWindowId } from "../../state/browser/hooks";
import { firstStaying } from "../../state/drag/drops";
import { clickTab } from "../../state/sidebar/actions";
import { pressTabClose, useTabCloseControl } from "../../state/sidebar/closeControl";
import { openTabMenu } from "../../state/sidebar/menus";
import { currentMovingTabIds } from "../../state/tabs/topStrip";
import { TabBadges } from "../media/TabBadges";
import { TabIcon } from "../sidebar/TabIcon";
import { Button, ContextMenuArea, FadeLabel, Symbol, useHover } from "../ui";
import { HoverSlot } from "../ui/HoverSlot";
import { useTheme } from "../ui/theme";
import { toolbarPalette, useEasedColor } from "../ui/toolbarColors";
import { font } from "../ui/tokens";
import { DockContext, FloatingStrip } from "./context";
import { tabIn, tileHold } from "./dockCross";
import { FadeIn } from "./FadeIn";
import { CELL_STEP, dropAt, useOnto, type GroupOut, type StripDrag } from "./model";
import { PinnedFace } from "./PinnedFace";
import { SelectedTab } from "./SelectedTab";
import { dragRange, leaveIndex, type DragGeometry } from "./stripGroups";
import { CHIP_LABEL_GAP, CHIP_PAD, DROP_RING_WIDTH, GAP, ITEM_HEIGHT, ITEM_TOP, PINNED_CELL, TAB_RADIUS, TOP_STRIP_HEIGHT } from "./tokens";
import { useStripDrag } from "./useStripDrag";

export function DraggableChip({
  tabId,
  width,
  geometry,
  from,
  group,
  tuck,
  out,
}: {
  tabId: string;
  width: number;
  geometry: DragGeometry;
  from: number;
  group: string | null;
  tuck?: () => void;
  out?: GroupOut;
}) {
  const active = useIsActiveTab(tabId);
  const strip = useContext(DockContext);
  const latestStrip = useRef(strip);
  latestStrip.current = strip;
  const dock = !group && from >= 0 ? (strip?.dock ?? null) : null;
  const member = group && out && out.slot >= 0 ? out : null;
  const stripEnd = member ? member.top.lefts.at(-1)! + member.top.slots.at(-1)!.width : 0;
  const range: StripDrag["range"] = dock
    ? (grab) => [Math.min(0, dock.left - geometry.lefts[from]! - grab + PINNED_CELL / 2), dragRange(geometry, from)[1]]
    : member
      ? [member.top.lefts[0]! - member.left - width / 2, stripEnd - member.left - width / 2]
      : undefined;
  const drag = useStripDrag({
    tabId,
    ids: () => currentMovingTabIds(tabId),
    pinned: false,
    groupId: group,
    geometry,
    from,
    width,
    gap: GAP,
    range,
    cross: dock ? tabIn(() => latestStrip.current, from, width) : undefined,
    targets: !group && from >= 0 ? strip?.targets : undefined,
    drop: (dx, ids) => {
      if (!member) return false;
      const at = leaveIndex(member.top, member.slot, member.chip, member.expanded, member.left + dx, width);
      if (at === null) return false;
      dropAt(ids, { zone: "list", beforeId: firstStaying(member.top.slots.slice(at), ids) });
      return true;
    },
  });
  return (
    <Animated.View ref={drag.ref} {...drag.panHandlers} mouseDownCanMoveWindow={false} style={{ ...drag.style, zIndex: drag.dragging ? 10 : active ? 1 : 0 }}>
      <View style={{ opacity: drag.crossed ? 0 : 1 }}>
        <TabChip tabId={tabId} width={width} tuck={tuck} dragged={drag.dragging} />
      </View>
      {drag.crossed && dock && (
        <FadeIn
          style={{
            left: drag.grab - PINNED_CELL / 2,
            top: ITEM_TOP + 0.5,
            transform: [{ translateX: tileHold(drag.dx, dock.left + dock.ids.length * CELL_STEP - geometry.lefts[from]! - drag.grab + PINNED_CELL / 2) }],
          }}
        >
          <PinnedFace tabId={tabId} active={active} hovered={false} pressed={false} />
        </FadeIn>
      )}
    </Animated.View>
  );
}

export function useWebsiteBand(tabId: string) {
  const theme = useTheme();
  const extend = useSettings((s) => s.extendWebsiteColor);
  const url = useTab(tabId)?.url;
  const themeColor = useTabLive(tabId, (l) => l.themeColor);
  const palette = toolbarPalette(theme, extend && url ? themeColor : null);
  return { palette, band: useEasedColor(palette.background) };
}

export function TabChip({ tabId, width, tuck, dragged }: { tabId: string; width: number; tuck?: () => void; dragged: boolean }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const tab = useTab(tabId);
  const onto = useOnto({ kind: "tab", id: tabId });
  const active = useIsActiveTab(tabId);
  const floating = useContext(FloatingStrip);
  const playing = useTabLive(tabId, (l) => l.playingAudio);
  const { palette, band } = useWebsiteBand(tabId);
  const closeControl = useTabCloseControl(tabId);
  const { hovered, hoverProps } = useHover();
  if (!tab) return null;
  const title = tab.customTitle || tab.title || tab.url || "New Tab";
  const onBand = active && !floating && !!palette.background;
  return (
    <View {...hoverProps} tooltip={tab.url ? `${title}\n${tab.url}` : title} style={{ width, height: TOP_STRIP_HEIGHT }}>
      {active && <SelectedTab width={width} band={band} opaque={dragged} />}
      {dragged && !active && (
        <View pointerEvents="none" style={{ position: "absolute", left: 0, width, top: ITEM_TOP, height: ITEM_HEIGHT, borderRadius: TAB_RADIUS, backgroundColor: theme.windowTint[0] }} />
      )}
      {onto && <OntoRing width={width} />}
      <ContextMenuArea onContextMenu={() => void openTabMenu(windowId, tab)} style={StyleSheet.absoluteFill}>
        <Pressable onPress={(e) => clickTab(windowId, tab.id, modifiersOf(e))} style={{ flex: 1 }}>
          {({ pressed }) => (
            <ItemRow hovered={(hovered || dragged) && !active && !onto} pressed={pressed && !active}>
              <View pointerEvents="none">
                <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
                <TabBadges tabId={tab.id} pip={false} />
              </View>
              {(playing || tab.muted) && (
                <Pressable onPress={() => toggleMute(tab.id)} style={{ marginLeft: CHIP_LABEL_GAP }} tooltip={tab.muted ? "Unmute" : "Mute"}>
                  <Symbol name={tab.muted ? "speaker.slash" : "speaker.wave.2"} size={11} color={onBand ? palette.icon : theme.textTab} style={{ width: 16, height: 16 }} />
                </Pressable>
              )}
              <FadeLabel
                text={title}
                fontSize={font.small.fontSize}
                color={onBand ? palette.text : active ? theme.tabSelectedText : theme.textTab}
                style={{ flex: 1, height: 16, marginLeft: CHIP_LABEL_GAP }}
              />
              <HoverSlot
                hovered={hovered}
                width={20}
                hover={
                  <Button variant="icon"
                    icon={tuck ? "minus" : closeControl.icon}
                    size={9}
                    weight="semibold"
                    box={20}
                    radius={5}
                    color={onBand ? palette.icon : undefined}
                    onPress={tuck ?? (() => pressTabClose(tab.id))}
                    tooltip={tuck ? "Hide in Group" : closeControl.tooltip}
                  />
                }
              />
            </ItemRow>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}

export function OntoRing({ width }: { width: number | Animated.Value }) {
  const theme = useTheme();
  return (
    <FadeIn
      style={{
        left: 0,
        top: ITEM_TOP,
        width,
        height: ITEM_HEIGHT,
        borderRadius: TAB_RADIUS,
        borderWidth: DROP_RING_WIDTH,
        borderColor: theme.accent,
        backgroundColor: theme.tabPressed,
      }}
    >
      {null}
    </FadeIn>
  );
}

export function ItemRow({ hovered, pressed, children }: { hovered: boolean; pressed: boolean; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: ITEM_TOP,
        height: ITEM_HEIGHT,
        borderRadius: TAB_RADIUS,
        backgroundColor: pressed ? theme.tabPressed : hovered ? theme.tabHover : undefined,
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: CHIP_PAD.left,
        paddingRight: CHIP_PAD.right,
      }}
    >
      {children}
    </View>
  );
}
