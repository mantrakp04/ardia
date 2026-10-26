import { memo, useRef } from "react";
import { Animated, Pressable, View } from "react-native";
import { ContextMenuArea, radius, Symbol } from "../ui";
import { useTheme } from "../ui/theme";
import { sidebarTokens } from "./tokens";
import { useTab, useWindowId } from "../../state/browser/hooks";
import { useShownFolderTab, useTileFolderMembers } from "../../state/pins/hooks";
import { useDragItem, useFolderTarget } from "./DragProvider";
import { dismissHover, useRowHover } from "../../state/sidebar/hover";
import { registerRow } from "../../state/sidebar/sidebarUi";
import { TabIcon } from "./TabIcon";
import { FolderDropRing, RestingTile, TileFace, useSlotPosition } from "./TileFace";
import { closedByPress, openTileFolderMenu, toggleFolderPanel, useFolderPanel } from "../../state/sidebar/tileFolderUi";

const MOSAIC_CELL = 9;
const MOSAIC_GAP = 2;
const MOSAIC_PAD = 3.5;
const MOSAIC = MOSAIC_PAD * 2 + MOSAIC_CELL * 2 + MOSAIC_GAP;

export const FolderTile = memo(function FolderTile({ folderId, width, sliding, x, y }: { folderId: string; width: number; sliding: boolean; x: number; y: number }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const members = useTileFolderMembers(windowId, folderId);
  const shown = useShownFolderTab(windowId, folderId);
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
        borderRadius: radius.button,
        padding: MOSAIC_PAD,
        flexDirection: "row",
        flexWrap: "wrap",
        gap: MOSAIC_GAP,
        backgroundColor: sidebarTokens(theme).folderMosaic,
      }}
    >
      {tabIds.slice(0, 4).map((id) => (
        <MosaicIcon key={id} tabId={id} />
      ))}
    </View>
  );
}

function MosaicIcon({ tabId }: { tabId: string }) {
  const tab = useTab(tabId);
  if (!tab) return <View style={{ width: MOSAIC_CELL, height: MOSAIC_CELL }} />;
  return (
    <View style={{ width: MOSAIC_CELL, height: MOSAIC_CELL, alignItems: "center", justifyContent: "center" }}>
      <TabIcon tabId={tabId} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={MOSAIC_CELL} />
    </View>
  );
}
