import { useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, View, type LayoutRectangle } from "react-native";
import { addFolderToSidebar } from "../../state/bookmarks/bookmarkGroups";
import { useBookmarkProfileId, useBookmarks, useSidebarEdge } from "../../state/bookmarks/hooks";
import { openModeFor, openUrl } from "../../state/bookmarks/actions";
import { useWindowId } from "../../state/browser/hooks";
import { openImport } from "../../state/settings/settingsWindows";
import { Favicon } from "../favicon/Favicon";
import { useSidebarWidth } from "../sidebar/tokens";
import { ContextMenuArea, MouseArea, radius, space, Symbol, Text, useHover, useTheme } from "../ui";
import { openBarMenu, openFolderMenu, openImportButtonMenu, type ClickMods } from "../../state/bookmarks/barMenus";
import { bookmarksBar } from "./tokens";

const BUTTON = {
  height: bookmarksBar.item,
  maxWidth: bookmarksBar.itemMaxWidth,
  borderRadius: radius.m,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  gap: space.s,
} as const;
const ICON = { width: bookmarksBar.iconBox, height: bookmarksBar.iconBox } as const;
const TITLE = { flexShrink: 1 } as const;

export function BarItem({
  id,
  windowId,
  profileId,
  hidden,
  highlighted,
  onLayout,
  onDragMove,
  onDragEnd,
}: {
  id: string;
  windowId: string;
  profileId: string;
  hidden: boolean;
  highlighted: boolean;
  onLayout: (r: LayoutRectangle) => void;
  onDragMove: (dx: number) => void;
  onDragEnd: (dx: number) => void;
}) {
  const node = useBookmarks((b) => b.nodes[id]);
  const width = useSidebarWidth(windowId);
  const sidebarEdge = useSidebarEdge(windowId, width);
  const edge = useRef(sidebarEdge);
  edge.current = sidebarEdge;
  const dx = useRef(new Animated.Value(0)).current;
  const left = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [overSidebar, setOverSidebar] = useState(false);
  const handlers = useRef({ onDragMove, onDragEnd });
  const folder = useRef(false);
  handlers.current = { onDragMove, onDragEnd };
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4,
        onPanResponderGrant: () => setDragging(true),
        onPanResponderMove: (_, g) => {
          const toSidebar = folder.current && g.moveX < edge.current;
          dx.setValue(toSidebar ? -left.current : g.dx);
          setOverSidebar(toSidebar);
          handlers.current.onDragMove(toSidebar ? Infinity : g.dx);
        },
        onPanResponderRelease: (_, g) => {
          dx.setValue(0);
          setDragging(false);
          setOverSidebar(false);
          if (folder.current && g.moveX < edge.current) {
            handlers.current.onDragMove(Infinity);
            addFolderToSidebar(id, windowId);
            return;
          }
          handlers.current.onDragEnd(g.dx);
        },
        onPanResponderTerminate: () => {
          dx.setValue(0);
          setDragging(false);
          setOverSidebar(false);
          handlers.current.onDragMove(0);
          handlers.current.onDragEnd(0);
        },
      }),
    [],
  );
  folder.current = node?.kind === "folder";
  if (!node) return null;
  const open = (e: { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; middle?: boolean }) =>
    node.kind === "url" ? openUrl(node.url, windowId, openModeFor(e)) : void openFolderMenu(windowId, node.children, undefined, node.id);

  return (
    <Animated.View
      {...responder.panHandlers}
      onLayout={(e) => {
        left.current = e.nativeEvent.layout.x;
        onLayout(e.nativeEvent.layout);
      }}
      pointerEvents={hidden ? "none" : "auto"}
      style={{ opacity: hidden ? 0 : dragging ? bookmarksBar.dragOpacity : 1, zIndex: dragging ? 10 : 0, transform: [{ translateX: dx }] }}
    >
      <ContextMenuArea onContextMenu={() => void openBarMenu(windowId, profileId, node)}>
        <MouseArea onMiddleClick={(e) => open({ ...e, middle: true })}>
          <BarButton
            favicon={node.kind === "url" ? node : undefined}
            icon={node.kind === "folder" ? "folder" : undefined}
            title={node.title || (node.kind === "url" ? node.url : "")}
            tooltip={node.kind === "url" ? `${node.title}\n${node.url}` : node.title}
            highlighted={highlighted || overSidebar}
            onPress={(e) => open(e)}
          />
        </MouseArea>
      </ContextMenuArea>
    </Animated.View>
  );
}

export function BarButton({
  title,
  icon,
  favicon,
  tooltip,
  onPress,
  width,
  highlighted,
}: {
  title?: string;
  icon?: string;
  favicon?: { url: string; favicon: string | null };
  tooltip?: string;
  onPress: (e: ClickMods) => void;
  width?: number;
  highlighted?: boolean;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const windowId = useWindowId();
  const profileId = useBookmarkProfileId(windowId);
  return (
    <View {...hoverProps} tooltip={tooltip}>
      <Pressable onPress={(e) => onPress(e.nativeEvent as unknown as ClickMods)}>
        {({ pressed }) => (
          <View
            style={[
              BUTTON,
              { width, paddingHorizontal: title ? space.sm : 0, backgroundColor: pressed ? theme.toolbarPressed : hovered || highlighted ? theme.toolbarHover : undefined },
            ]}
          >
            {favicon ? (
              <Favicon url={favicon.url} favicon={favicon.favicon} size={bookmarksBar.favicon} profileId={profileId} />
            ) : icon ? (
              <Symbol name={icon} size={bookmarksBar.icon} color={theme.icon} style={ICON} />
            ) : null}
            {title ? (
              <Text lines={1} size="small" tone="textTab" style={TITLE}>
                {title}
              </Text>
            ) : null}
          </View>
        )}
      </Pressable>
    </View>
  );
}

export function ImportButton() {
  return (
    <ContextMenuArea
      onContextMenu={() => void openImportButtonMenu()}
    >
      <BarButton icon="rectangle.portrait.and.arrow.right" title="Import bookmarks" tooltip="Add bookmarks from another browser" onPress={() => openImport()} />
    </ContextMenuArea>
  );
}
