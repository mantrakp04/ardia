import { useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, View } from "react-native";
import { bookmarkAncestors } from "../../state/bookmarks/bookmarks";
import { useBookmarks } from "../../state/bookmarks/hooks";
import { openUrl } from "../../state/bookmarks/actions";
import { plural } from "../../state/browser/model";
import { Favicon } from "../favicon/Favicon";
import { Button, ContextMenuArea, MouseArea, radius, space, Symbol, Text, useHover, useTheme } from "../ui";
import { openBookmarkRowMenu } from "../../state/bookmarks/bookmarkMenus";
import { hostLabel } from "./PageLayout";
import { bookmarkList, pagesColors } from "./tokens";

const ROW_LOOK = { height: bookmarkList.row, borderRadius: radius.button, flexDirection: "row", alignItems: "center", paddingHorizontal: space.ml, gap: space.ml } as const;
const FOLDER_ICON = { width: bookmarkList.folderIconBox, height: bookmarkList.folderIconBox } as const;
const TITLE = { flexShrink: 1 } as const;
const DETAIL = { flex: 1 } as const;

export function BookmarkRow({
  id,
  windowId,
  profileId,
  showPath,
  selected,
  highlighted,
  targetRef,
  onSelect,
  onOpenFolder,
  onDelete,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  id: string;
  windowId: string;
  profileId: string;
  showPath: boolean;
  selected: boolean;
  highlighted: boolean;
  targetRef: (v: View | null) => void;
  onSelect: (e: { metaKey?: boolean; shiftKey?: boolean }) => void;
  onOpenFolder: (folder?: string) => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
}) {
  const theme = useTheme();
  const colors = theme.dark ? pagesColors.dark : pagesColors.light;
  const node = useBookmarks((b) => b.nodes[id]);
  const path = useBookmarks((b) => (showPath ? bookmarkAncestors(b, id).map((a) => a.title).reverse().join(" › ") : ""));
  const { hovered, hoverProps } = useHover();
  const dy = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);
  const handlers = useRef({ onDragStart, onDragMove, onDragEnd });
  handlers.current = { onDragStart, onDragMove, onDragEnd };
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4 || Math.abs(g.dx) > 8,
        onPanResponderGrant: () => {
          setDragging(true);
          handlers.current.onDragStart();
        },
        onPanResponderMove: (_, g) => {
          dy.setValue(g.dy);
          handlers.current.onDragMove(g.moveX, g.moveY);
        },
        onPanResponderRelease: (_, g) => {
          dy.setValue(0);
          setDragging(false);
          handlers.current.onDragEnd(g.moveX, g.moveY);
        },
        onPanResponderTerminate: () => {
          dy.setValue(0);
          setDragging(false);
          handlers.current.onDragEnd(-1, -1);
        },
      }),
    [],
  );
  if (!node) return null;

  const open = (mode: Parameters<typeof openUrl>[2]) => node.kind === "url" && openUrl(node.url, windowId, mode);
  const menu = () => {
    if (!selected) onSelect({});
    return openBookmarkRowMenu(node, { windowId, profileId, showPath, onOpenFolder, onDelete });
  };

  return (
    <Animated.View
      ref={targetRef as never}
      {...responder.panHandlers}
      {...hoverProps}
      style={{ zIndex: dragging ? 10 : 0, opacity: dragging ? bookmarkList.dragOpacity : 1, transform: [{ translateY: dy }] }}
    >
      <ContextMenuArea onContextMenu={() => void menu()}>
        <MouseArea onMiddleClick={() => open("background")}>
          <Pressable onPress={(e) => onSelect(e.nativeEvent as unknown as { metaKey?: boolean; shiftKey?: boolean })}>
            <View
              onDoubleClick={() => (node.kind === "folder" ? onOpenFolder() : void open("current"))}
              style={[ROW_LOOK, { backgroundColor: selected ? colors.rowSelected : highlighted ? colors.dropTarget : hovered ? theme.rowHover : undefined }]}
            >
              {node.kind === "url" ? (
                <Favicon url={node.url} favicon={node.favicon} profileId={profileId} />
              ) : (
                <Symbol name="folder" size={bookmarkList.folderIcon} color={theme.icon} style={FOLDER_ICON} />
              )}
              <Text lines={1} style={TITLE}>
                {node.title || (node.kind === "url" ? node.url : "")}
              </Text>
              <Text lines={1} size="small" tone="textTertiary" style={DETAIL}>
                {showPath ? path : node.kind === "url" ? hostLabel(node.url) : plural(node.children.length, "item")}
              </Text>
              <View style={{ opacity: hovered ? 1 : 0 }}>
                <Button variant="icon" icon="ellipsis" size={13} box={bookmarkList.menuBox} radius={radius.m} onPress={() => void menu()} tooltip="More actions" />
              </View>
            </View>
          </Pressable>
        </MouseArea>
      </ContextMenuArea>
    </Animated.View>
  );
}
