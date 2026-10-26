import { useContext, useMemo, useRef } from "react";
import { Animated, Pressable, View } from "react-native";
import { modifiersOf } from "../../lib/keys";
import { useIsActiveTab, useTab, useWindowId } from "../../state/browser/hooks";
import { folderIdOfCell } from "../../state/pins/tileFolders";
import { clickTab } from "../../state/sidebar/actions";
import { openTabMenu } from "../../state/sidebar/menus";
import { openTileFolderMenu } from "../../state/sidebar/tileFolderUi";
import { currentMovingTabIds, openTileFolderStripMenu, useTileFolderLabel } from "../../state/tabs/topStrip";
import { FolderMosaic } from "../sidebar/FolderTile";
import { ContextMenuArea, useHover } from "../ui";
import { useTheme } from "../ui/theme";
import { DockContext } from "./context";
import { pinOut } from "./dockCross";
import { FadeIn } from "./FadeIn";
import { dockWidth, reorder } from "./model";
import { PinnedFace } from "./PinnedFace";
import { dropIndex, type DragGeometry } from "./stripGroups";
import { TabChip } from "./TabChip";
import { CHIP_HAIRLINE, DOCK_GAP, GAP, ITEM_HEIGHT, ITEM_TOP, MAX_CHIP, PINNED_CELL, PINNED_FACE_INSET, PINNED_FACE_RADIUS, PINNED_SPACING, TAB_RADIUS, TOP_STRIP_HEIGHT } from "./tokens";
import { useStripDrag } from "./useStripDrag";

export function PinnedDock({ tabIds }: { tabIds: string[] }) {
  const theme = useTheme();
  const strip = useContext(DockContext)!;
  const geometry = strip.dock!.geometry;
  const width = dockWidth(tabIds.length);
  const box = useMemo(() => Animated.add(strip.grow, width), [strip.grow, width]);
  return (
    <View style={{ marginTop: ITEM_TOP, marginRight: DOCK_GAP - GAP, zIndex: 2, width, height: ITEM_HEIGHT, flexDirection: "row", alignItems: "center" }}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          height: ITEM_HEIGHT,
          width: box.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolateLeft: "clamp" }),
          opacity: box.interpolate({ inputRange: [0, PINNED_CELL / 2], outputRange: [0, 1], extrapolate: "clamp" }),
          borderRadius: TAB_RADIUS,
          borderWidth: CHIP_HAIRLINE,
          borderColor: theme.pinnedRestingStroke,
          backgroundColor: theme.pinnedResting,
        }}
      />
      <View style={{ flexDirection: "row", gap: PINNED_SPACING }}>
        {tabIds.map((id, i) => {
          const folderId = folderIdOfCell(id);
          return folderId ? (
            <FolderCell key={id} folderId={folderId} tabIds={geometry.slots[i]?.tabIds ?? []} geometry={geometry} from={i} />
          ) : (
            <PinnedCell key={id} tabId={id} geometry={geometry} from={i} />
          );
        })}
      </View>
    </View>
  );
}

function PinnedCell({ tabId, geometry, from }: { tabId: string; geometry: DragGeometry; from: number }) {
  const windowId = useWindowId();
  const tab = useTab(tabId);
  const active = useIsActiveTab(tabId);
  const { hovered, hoverProps } = useHover();
  const strip = useContext(DockContext);
  const latestStrip = useRef(strip);
  latestStrip.current = strip;
  const dock = strip?.dock;
  const top = strip?.top;
  const end = top && top.slots.length ? top.lefts.at(-1)! + top.slots.at(-1)!.width : MAX_CHIP;
  const range: [number, number] | undefined = dock ? [-geometry.lefts[from]!, end - dock.left - geometry.lefts[from]! - PINNED_CELL] : undefined;
  const drag = useStripDrag({
    tabId,
    ids: () => currentMovingTabIds(tabId),
    pinned: true,
    groupId: null,
    geometry,
    from,
    width: PINNED_CELL,
    gap: PINNED_SPACING,
    range,
    cross: dock ? pinOut(() => latestStrip.current, from) : undefined,
    levels: 2,
  });
  if (!tab) return null;
  return (
    <Animated.View ref={drag.ref} {...drag.panHandlers} mouseDownCanMoveWindow={false} style={drag.style}>
      <View {...hoverProps} style={{ opacity: drag.crossed ? 0 : 1 }} tooltip={`${tab.customTitle || tab.title || tab.url}${tab.url ? `\n${tab.url}` : ""}`}>
        <ContextMenuArea onContextMenu={() => void openTabMenu(windowId, tab)}>
          <Pressable onPress={(e) => clickTab(windowId, tab.id, modifiersOf(e))}>
            {({ pressed }) => <PinnedFace tabId={tabId} active={active} hovered={hovered} pressed={pressed} />}
          </Pressable>
        </ContextMenuArea>
      </View>
      {drag.crossed && strip && (
        <FadeIn style={{ left: 0, top: -(ITEM_TOP + 0.5), width: strip.chip, height: TOP_STRIP_HEIGHT }}>
          <TabChip tabId={tabId} width={strip.chip} dragged />
        </FadeIn>
      )}
    </Animated.View>
  );
}

function FolderCell({ folderId, tabIds, geometry, from }: { folderId: string; tabIds: string[]; geometry: DragGeometry; from: number }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const label = useTileFolderLabel(windowId, folderId);
  const { hovered, hoverProps } = useHover();
  const drag = useStripDrag({
    tabId: null,
    ids: () => tabIds,
    pinned: true,
    groupId: null,
    geometry,
    from,
    width: PINNED_CELL,
    gap: PINNED_SPACING,
    levels: 2,
    local: true,
    drop: (dx, ids) => reorder(ids, { tabId: null, ids: () => ids, pinned: true, groupId: null, geometry, from, width: PINNED_CELL, gap: PINNED_SPACING }, dropIndex(geometry, from, dx)),
  });
  return (
    <Animated.View ref={drag.ref} {...drag.panHandlers} mouseDownCanMoveWindow={false} style={drag.style}>
      <View {...hoverProps} tooltip={`${label}\nShow Folder`}>
        <ContextMenuArea onContextMenu={() => void openTileFolderMenu(windowId, folderId)}>
          <Pressable onPress={() => void openTileFolderStripMenu(windowId, folderId)}>
            {({ pressed }) => (
              <View style={{ width: PINNED_CELL, height: ITEM_HEIGHT - 1, alignItems: "center", justifyContent: "center" }}>
                {(hovered || pressed) && (
                  <View style={{ position: "absolute", left: PINNED_FACE_INSET, right: PINNED_FACE_INSET, top: PINNED_FACE_INSET, bottom: PINNED_FACE_INSET, borderRadius: PINNED_FACE_RADIUS, backgroundColor: pressed ? theme.tabPressed : theme.tabHover }} />
                )}
                <View pointerEvents="none">
                  <FolderMosaic tabIds={tabIds} />
                </View>
              </View>
            )}
          </Pressable>
        </ContextMenuArea>
      </View>
    </Animated.View>
  );
}
