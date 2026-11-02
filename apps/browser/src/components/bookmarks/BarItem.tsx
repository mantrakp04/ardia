import { forwardRef, useMemo, useRef, type ReactNode } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, View, type LayoutRectangle } from "react-native";
import { useBookmarkProfileId, useBookmarks, useSidebarEdge } from "../../state/bookmarks/hooks";
import { openModeFor, openUrl } from "../../state/bookmarks/actions";
import { barDragging, beginBookmarkDrag, endBookmarkDrag, moveBookmarkDrag, useBarDrag } from "../../state/bookmarks/barDrag";
import { folderMenuOpen, openFolderMenu, toggleFolderMenu, useFolderMenus } from "../../state/bookmarks/folderMenus";
import { useWindowId } from "../../state/browser/hooks";
import { openImport } from "../../state/settings/settingsWindows";
import { Favicon } from "../favicon/Favicon";
import { useSidebarWidth } from "../../state/sidebar/hooks";
import { ContextMenuArea, MouseArea, Symbol, Text, useHover, useTheme } from "../ui";
import { openBarMenu, openImportButtonMenu, type ClickMods } from "../../state/bookmarks/barMenus";
import { bookmarksBar, type BarSize } from "./tokens";
import { measureRect, useEased, useSlide } from "./barMotion";
import { useBarSize } from "./barSize";

export function useBookmarkDragResponder(
  view: { current: View | null },
  source: () => { windowId: string; id: string; panel: string | null; sidebarEdge: number },
  deps: unknown[],
) {
  const latest = useRef(source);
  latest.current = source;
  return useMemo(() => {
    let pressing = false;
    let last: [number, number] = [0, 0];
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.hypot(g.dx, g.dy) > bookmarksBar.dragStart,
      onPanResponderGrant: (_, g) => {
        pressing = true;
        last = [g.moveX || g.x0, g.moveY || g.y0];
        void measureRect(view.current).then((r) => {
          if (!pressing || !r) return;
          beginBookmarkDrag({ ...latest.current(), x: g.x0, y: g.y0, grab: { x: g.x0 - r.x, y: g.y0 - r.y, width: r.width, height: r.height } });
          moveBookmarkDrag(last[0], last[1]);
        });
      },
      onPanResponderMove: (_, g) => {
        last = [g.moveX, g.moveY];
        moveBookmarkDrag(g.moveX, g.moveY);
      },
      onPanResponderRelease: () => {
        pressing = false;
        endBookmarkDrag(true);
      },
      onPanResponderTerminate: () => {
        pressing = false;
        endBookmarkDrag(false);
      },
      onPanResponderTerminationRequest: () => false,
    });
  }, deps);
}

export function BarItem({
  id,
  windowId,
  profileId,
  hidden,
  offset,
  onLayout,
}: {
  id: string;
  windowId: string;
  profileId: string;
  hidden: boolean;
  offset: number;
  onLayout: (r: LayoutRectangle) => void;
}) {
  const node = useBookmarks((b) => b.nodes[id]);
  const size = useBarSize();
  const width = useSidebarWidth(windowId);
  const sidebarEdge = useSidebarEdge(windowId, width);
  const edge = useRef(sidebarEdge);
  edge.current = sidebarEdge;
  const view = useRef<View | null>(null);
  const dragging = useBarDrag((s) => s.source?.kind === "bookmark" && s.source.id === id);
  const dropInto = useBarDrag((s) => !!s.spot && "into" in s.spot && s.spot.into === id);
  const menuOpen = useFolderMenus((s) => s.windowId === windowId && s.panels.some((p) => p.level === 0 && !p.retained && p.key === id));
  const shift = useSlide(offset);
  const responder = useBookmarkDragResponder(view, () => ({ windowId, id, panel: null, sidebarEdge: edge.current }), [windowId, id]);
  if (!node) return null;
  const folder = node.kind === "folder";
  const openMenu = (toggle: boolean) =>
    void measureRect(view.current).then((anchor) => {
      if (!anchor) return;
      if (toggle) toggleFolderMenu(windowId, { parentId: id, fromIndex: 0, anchor });
      else openFolderMenu(windowId, { parentId: id, fromIndex: 0, anchor, level: 0 });
    });
  const open = (e: ClickMods & { middle?: boolean }) => (node.kind === "url" ? openUrl(node.url, windowId, openModeFor(e)) : openMenu(true));

  return (
    <Animated.View
      ref={view}
      collapsable={false}
      {...responder.panHandlers}
      onLayout={(e) => onLayout(e.nativeEvent.layout)}
      onMouseEnter={folder ? () => !barDragging() && folderMenuOpen(windowId) && openMenu(false) : undefined}
      pointerEvents={hidden ? "none" : "auto"}
      style={{ opacity: hidden || dragging ? 0 : 1, marginRight: size.itemGap, transform: [{ translateX: shift }] }}
    >
      <ContextMenuArea onContextMenu={() => void openBarMenu(windowId, profileId, node)}>
        <MouseArea onMiddleClick={(e) => open({ ...e, middle: true })}>
          <BarButton
            favicon={node.kind === "url" ? node : undefined}
            icon={folder ? "folder" : undefined}
            title={node.title || (node.kind === "url" ? node.url : "")}
            tooltip={node.kind === "url" ? `${node.title}\n${node.url}` : node.title}
            active={menuOpen}
            dropRing={dropInto}
            onPress={open}
          />
        </MouseArea>
      </ContextMenuArea>
    </Animated.View>
  );
}

export const BarButton = forwardRef<View, {
  title?: string;
  icon?: string;
  favicon?: { url: string; favicon: string | null };
  tooltip?: string;
  onPress: (e: ClickMods) => void;
  width?: number;
  active?: boolean;
  dropRing?: boolean;
}>(function BarButton({ title, icon, favicon, tooltip, onPress, width, active, dropRing }, ref) {
  const { hovered, hoverProps } = useHover();
  const size = useBarSize();
  return (
    <View ref={ref} collapsable={false} {...hoverProps} tooltip={tooltip}>
      <Pressable accessibilityRole="button" accessibilityLabel={title ?? tooltip} onPress={(e) => onPress(e.nativeEvent as unknown as ClickMods)}>
        {({ pressed }) => (
          <Chip size={size} width={width} padded={!!title} hovered={hovered || active || dropRing} pressed={pressed || !!active} dropRing={dropRing}>
            <ChipIcon size={size} favicon={favicon} icon={icon} />
            {title ? (
              <Text lines={1} size={size.text} tone="textTab" style={TITLE}>
                {title}
              </Text>
            ) : null}
          </Chip>
        )}
      </Pressable>
    </View>
  );
});

export function Chip({
  size,
  width,
  padded,
  hovered = false,
  pressed = false,
  dropRing = false,
  children,
}: {
  size: BarSize;
  width?: number;
  padded: boolean;
  hovered?: boolean;
  pressed?: boolean;
  dropRing?: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  const plate = useEased(hovered || pressed);
  const ring = useEased(dropRing);
  const shape = { borderRadius: size.radius, borderCurve: "continuous" } as const;
  return (
    <View
      style={{
        height: size.item,
        width,
        maxWidth: size.itemMaxWidth,
        paddingHorizontal: padded ? size.padding : 0,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: size.titleGap,
      }}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, shape, { opacity: plate, backgroundColor: pressed ? theme.toolbarPressed : theme.toolbarHover }]} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, shape, { opacity: ring, borderWidth: bookmarksBar.dropRing, borderColor: theme.accent }]} />
      {children}
    </View>
  );
}

export type IconMetrics = Pick<BarSize, "favicon" | "icon" | "iconBox">;

export function ChipIcon({ size, favicon, icon }: { size: IconMetrics; favicon?: { url: string; favicon: string | null }; icon?: string }) {
  const theme = useTheme();
  const profileId = useBookmarkProfileId(useWindowId());
  if (favicon) return <Favicon url={favicon.url} favicon={favicon.favicon} size={size.favicon} profileId={profileId} />;
  if (icon) return <Symbol name={icon} size={size.icon} color={theme.icon} style={{ width: size.iconBox, height: size.iconBox }} />;
  return null;
}

const TITLE = { flexShrink: 1 } as const;

export function ImportButton() {
  return (
    <ContextMenuArea onContextMenu={() => void openImportButtonMenu()}>
      <BarButton icon="rectangle.portrait.and.arrow.right" title="Import bookmarks" tooltip="Add bookmarks from another browser" onPress={() => openImport()} />
    </ContextMenuArea>
  );
}
