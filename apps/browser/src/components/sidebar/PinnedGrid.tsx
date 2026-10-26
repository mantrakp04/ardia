import { memo } from "react";
import { Animated, Pressable, View } from "react-native";
import { closeTab } from "../../state/browser/actions";
import { ContextMenuArea, MouseArea, Symbol } from "../ui";
import { layout, useTheme } from "../ui/theme";
import { useAddressBarInSidebar } from "../../state/windows/layout";
import { listTopGap } from "./geometry";
import { useIsActiveTab, useSettings, useTab, useTabLive, useWindowId } from "../../state/browser/hooks";
import { useIsSelected } from "../../state/pins/hooks";
import { NextMeetingBadge } from "../live/NextMeetingBadge";
import { clickTab, returnShownTabToPinnedUrl } from "../../state/sidebar/actions";
import { cellKey, PIN_SLOT } from "./dragModel";
import { useDragController, useDragging, useDragItem, useDropPins, useFolderTarget, usePinnedCount, usePinSlots } from "./DragProvider";
import { FolderTile } from "./FolderTile";
import { dismissHover, useRowHover } from "../../state/sidebar/hover";
import { openTabMenu } from "../../state/sidebar/menus";
import { pinGrid, pinGridHeight, TILE_GAP } from "./pinZone";
import { registerRow } from "../../state/sidebar/sidebarUi";
import { modifiersOf } from "../../lib/keys";
import { FolderDropRing, TileFace, useSlotPosition } from "./TileFace";
import { folderIdOfCell } from "../../state/pins/tileFolders";
import { useSidebarTokens } from "./tokens";

export const PinnedGrid = memo(function PinnedGrid({ tabs, innerWidth, flush = false }: { tabs: string[]; innerWidth: number; flush?: boolean }) {
  const controller = useDragController();
  const count = usePinnedCount(tabs);
  const balanced = useSettings((st) => st.balancedTopApps);
  const { columns, width } = pinGrid(count, innerWidth, balanced);
  const slots = usePinSlots(tabs);
  const tail = useDragItem("tail:tiles", { kind: "tail", tabIds: [], section: "tiles" });
  const dragging = useDragging();
  const addressBar = useAddressBarInSidebar();
  const topGap = listTopGap(addressBar);
  if (!tabs.length) return dragging && !addressBar && tail.gap ? <Animated.View style={{ height: tail.gap }} /> : null;
  return (
    <View
      ref={(v) => {
        controller?.regions.set("tiles", v);
      }}
      style={{ marginTop: flush ? 0 : topGap }}
    >
      <View style={{ height: pinGridHeight(count, innerWidth, layout.pinnedHeight, balanced) }}>
        {tabs.map((cell, i) => {
          const x = (slots[i]! % columns) * (width + TILE_GAP);
          const y = Math.floor(slots[i]! / columns) * PIN_SLOT;
          const folderId = folderIdOfCell(cell);
          return folderId ? (
            <FolderTile key={cellKey(cell)} folderId={folderId} width={width} sliding={dragging} x={x} y={y} />
          ) : (
            <PinnedTile key={cellKey(cell)} tabId={cell} width={width} sliding={dragging} x={x} y={y} />
          );
        })}
      </View>
      <Animated.View ref={tail.wrapper.ref} style={{ position: "absolute", right: 0, bottom: 0, width: 0, height: 0 }} />
    </View>
  );
});

export function PinFieldZone({ top, height }: { top: number; height: number }) {
  const tokens = useSidebarTokens();
  const theme = useTheme();
  const controller = useDragController();
  const active = useDropPins();
  return (
    <View
      ref={(v) => {
        controller?.regions.set("tiles", v);
      }}
      onLayout={() => void controller?.tilesLaidOut()}
      pointerEvents="none"
      style={{
        position: "absolute",
        left: layout.sidebarInset,
        right: layout.sidebarInset,
        top,
        height,
        borderRadius: 10,
        borderWidth: active ? 1.5 : 1,
        borderStyle: "dashed",
        borderColor: active ? theme.accent : tokens.dragBorder,
        backgroundColor: tokens.dragSilhouette,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <PinGlyph color={active ? theme.accent : theme.textSecondary} />
    </View>
  );
}

export function PinSlotZone() {
  const theme = useTheme();
  const controller = useDragController();
  const active = useDropPins();
  const gap = controller?.items.get("tail:tiles")?.gap;
  const opacity = gap ? gap.interpolate({ inputRange: [0, PIN_SLOT], outputRange: [0, 1], extrapolate: "clamp" }) : active ? 1 : 0;
  return (
    <>
      <View
        ref={(v) => {
          controller?.regions.set("tiles", v);
        }}
        onLayout={() => void controller?.tilesLaidOut()}
        pointerEvents="none"
        style={{
          position: "absolute",
          left: layout.sidebarInset,
          right: layout.sidebarInset,
          top: 0,
          height: active ? layout.pinnedTop + layout.pinnedHeight : layout.pinnedTop - layout.rowGap,
        }}
      />
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: layout.sidebarInset,
          right: layout.sidebarInset,
          top: layout.pinnedTop,
          height: layout.pinnedHeight,
          opacity,
          borderRadius: 10,
          borderWidth: 1.5,
          borderStyle: "dashed",
          borderColor: theme.accent,
          backgroundColor: theme.dropZoneFill,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <PinGlyph color={theme.accent} />
      </Animated.View>
    </>
  );
}

function PinGlyph({ color }: { color: string }) {
  return <Symbol name="pin" size={13} color={color} style={{ width: 16, height: 16 }} />;
}

const PinnedTile = memo(function PinnedTile({ tabId, width, sliding, x, y }: { tabId: string; width: number; sliding: boolean; x: number; y: number }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const tab = useTab(tabId);
  const active = useIsActiveTab(tabId);
  const selected = useIsSelected(windowId, tabId);
  const playing = useTabLive(tabId, (l) => l.playingAudio);
  const { hovered, hoverProps } = useRowHover(windowId, { kind: "tab", id: tabId });
  const { wrapper, handle, dragging } = useDragItem(`t:${tabId}`, { kind: "tile", tabIds: [tabId], section: "tiles" });
  const target = useFolderTarget(`t:${tabId}`);
  const position = useSlotPosition(x, y, width, sliding, dragging);
  if (!tab) return null;

  return (
    <Animated.View ref={wrapper.ref} style={[{ position: "absolute", ...position.getLayout() }, wrapper.style]} {...handle}>
      <FolderDropRing on={target} />
      <View
        ref={(v) => registerRow(windowId, tabId, v)}
        {...hoverProps}
        onDoubleClick={() => returnShownTabToPinnedUrl(windowId, tabId)}
      >
        <MouseArea onMiddleClick={() => void closeTab(tabId)}>
          <ContextMenuArea
            onContextMenu={() => {
              dismissHover();
              void openTabMenu(windowId, tab);
            }}
          >
            <Pressable
              onPress={(e) => {
                dismissHover();
                clickTab(windowId, tabId, modifiersOf(e));
              }}
            >
              {({ pressed }) => <TileFace tabId={tabId} width={width} active={active} selected={selected} hovered={hovered} pressed={pressed} />}
            </Pressable>
          </ContextMenuArea>
        </MouseArea>
        <NextMeetingBadge tabId={tabId} />
        {playing || tab.muted ? (
          <View pointerEvents="none" style={{ position: "absolute", bottom: 3, right: 4 }}>
            <Symbol name={tab.muted ? "speaker.slash.fill" : "speaker.wave.2.fill"} size={8} color={theme.textSecondary} style={{ width: 12, height: 10 }} />
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
});
