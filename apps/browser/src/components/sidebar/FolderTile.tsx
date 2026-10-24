import { ContextMenuArea, Symbol } from "@ardia/shell";
import { memo, useRef } from "react";
import { Animated, Pressable, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import { activeTabId } from "../../store/model";
import { folderMembers, tileFolderOf } from "../../store/tileFolders";
import { useDragItem, useFolderTarget } from "./dnd";
import { dismissHover, useRowHover } from "./hover";
import { registerRow } from "./state";
import { TabIcon } from "./TabIcon";
import { FolderDropRing, RestingTile, TileFace, useSlotPosition } from "./TileFace";
import { closedByPress, openTileFolderMenu, toggleFolderPanel, useFolderPanel } from "./tileFolderUi";

const MOSAIC_CELL = 9;
const MOSAIC_GAP = 2;
const MOSAIC_PAD = 3.5;
const MOSAIC = MOSAIC_PAD * 2 + MOSAIC_CELL * 2 + MOSAIC_GAP;

export const FolderTile = memo(function FolderTile({ folderId, width, sliding, x, y }: { folderId: string; width: number; sliding: boolean; x: number; y: number }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const members = useBrowser(useShallow((s) => folderMembers(s, windowId, folderId)));
  const shown = useBrowser((s) => {
    const id = activeTabId(s, windowId);
    return id && tileFolderOf(s.tabs[id])?.id === folderId ? id : null;
  });
  const open = useFolderPanel((u) => u.open?.windowId === windowId && u.open.folderId === folderId);
  const { hovered, hoverProps } = useRowHover(windowId, { kind: "folder", id: folderId });
  const { wrapper, handle, dragging } = useDragItem(`tf:${folderId}`, { kind: "tile", tabIds: members, section: "tiles", folderId });
  const target = useFolderTarget(`tf:${folderId}`);
  const position = useSlotPosition(x, y, width, sliding, dragging);
  const pressedAt = useRef<number | undefined>(undefined);
  if (!members.length) return null;
  const glyph = <Symbol name="folder.fill" size={7} color={theme.textSecondary} style={{ position: "absolute", bottom: 3, right: 4, width: 10, height: 9 }} />;

  return (
    <Animated.View ref={wrapper.ref} style={[{ position: "absolute", ...position.getLayout() }, wrapper.style]} {...handle}>
      <FolderDropRing on={target} />
      <View ref={(v) => registerRow(windowId, folderId, v)} {...hoverProps}>
        <ContextMenuArea onContextMenu={() => void openTileFolderMenu(windowId, folderId)}>
          <Pressable
            onPressIn={(e) => void (pressedAt.current = e.nativeEvent.timestamp)}
            onPress={() => {
              dismissHover();
              if (!closedByPress(folderId, pressedAt.current)) void toggleFolderPanel(windowId, folderId);
            }}
          >
            {({ pressed }) =>
              shown ? (
                <TileFace tabId={shown} width={width} active selected={false} hovered={hovered} pressed={pressed} badge={glyph} />
              ) : (
                <RestingTile width={width} selected={open} hovered={hovered} pressed={pressed}>
                  <FolderMosaic tabIds={members} />
                </RestingTile>
              )
            }
          </Pressable>
        </ContextMenuArea>
      </View>
    </Animated.View>
  );
});

export function FolderMosaic({ tabIds }: { tabIds: string[] }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: MOSAIC,
        height: MOSAIC,
        borderRadius: 7,
        padding: MOSAIC_PAD,
        flexDirection: "row",
        flexWrap: "wrap",
        gap: MOSAIC_GAP,
        backgroundColor: theme.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)",
      }}
    >
      {tabIds.slice(0, 4).map((id) => (
        <MosaicIcon key={id} tabId={id} />
      ))}
    </View>
  );
}

function MosaicIcon({ tabId }: { tabId: string }) {
  const tab = useBrowser((s) => s.tabs[tabId]);
  if (!tab) return <View style={{ width: MOSAIC_CELL, height: MOSAIC_CELL }} />;
  return (
    <View style={{ width: MOSAIC_CELL, height: MOSAIC_CELL, alignItems: "center", justifyContent: "center" }}>
      <TabIcon tabId={tabId} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={MOSAIC_CELL} />
    </View>
  );
}
