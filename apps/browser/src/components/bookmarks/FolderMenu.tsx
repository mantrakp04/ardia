import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { useBookmarkProfileId, useBookmarks, useSidebarEdge } from "../../state/bookmarks/hooks";
import { openFolder, openModeFor, openUrl } from "../../state/bookmarks/actions";
import { addFolderToSidebar, makesGroup } from "../../state/bookmarks/bookmarkGroups";
import { folderLinks } from "../../state/bookmarks/bookmarks";
import { registerDropZone, useBarDrag } from "../../state/bookmarks/barDrag";
import { roomOffsets, zoneHitAt } from "../../state/bookmarks/barDrop";
import { closeFolderMenus, closeMenusAbove, openFolderMenu, useFolderMenus, type FolderMenuPanel, type MenuRect } from "../../state/bookmarks/folderMenus";
import { openAllItems, openAllModeOf } from "../../state/bookmarks/linkMenus";
import { currentBookmarks } from "../../state/browser/current";
import { openBarMenu } from "../../state/bookmarks/barMenus";
import { modifiersOf } from "../../lib/keys";
import { useSidebarWidth } from "../../state/sidebar/hooks";
import { ContextMenuArea, menuRowFill, MenuSeparator, MouseArea, opacity, PANEL, PopoverSurface, Symbol, Text, usePopoverMotion, usePopoverMotionStyle, useTheme } from "../ui";
import { ChipIcon, useBookmarkDragResponder, type IconMetrics } from "./BarItem";
import { measureRect, useEased, useSlide } from "./barMotion";
import { useBarSize } from "./barSize";
import { bookmarksBar, folderMenu, type BarSize } from "./tokens";

const PAD = PANEL.rowInset;
const FAVICON_LEFT = PANEL.rowInset + PANEL.rowPadding;

export function placeMenu(panel: FolderMenuPanel, layer: MenuRect, width: number, height: number | null, size: BarSize) {
  const { anchor, level } = panel;
  const m = folderMenu.margin;
  let left: number;
  let top: number;
  if (level === 0) {
    left = Math.max(m, Math.min(anchor.x - FAVICON_LEFT + size.padding, layer.x + layer.width - width - m));
    top = anchor.y + anchor.height + folderMenu.offsetY;
  } else {
    left = anchor.x + anchor.width + PANEL.rowInset - folderMenu.cascadeOverlap;
    if (left + width > layer.x + layer.width - m) left = Math.max(m, anchor.x - PANEL.rowInset - width + folderMenu.cascadeOverlap);
    top = anchor.y - PAD;
    if (height !== null) top = Math.max(layer.y + m, Math.min(top, layer.y + layer.height - m - height));
  }
  return { x: left, y: top, width, maxHeight: Math.max(size.menuRow * 3, layer.y + layer.height - top - m) };
}

export function FolderMenu({ windowId, panel, layer, closing, onClosed }: { windowId: string; panel: FolderMenuPanel; layer: MenuRect; closing: boolean; onClosed: () => void }) {
  const size = useBarSize();
  const profileId = useBookmarkProfileId(windowId);
  const { parentId, fromIndex, level } = panel;
  const ids = useBookmarks(
    useShallow((b) => {
      const folder = b.nodes[parentId];
      return folder?.kind === "folder" ? folder.children.slice(fromIndex) : [];
    }),
  );
  const footer = useBookmarks(useShallow((b) => (fromIndex ? null : { links: folderLinks(b, parentId).length, group: makesGroup({ bookmarks: b }, parentId) })));
  const childOpen = useFolderMenus((s) => (s.windowId === windowId ? (s.panels.find((p) => p.level === level + 1 && !p.retained)?.parentId ?? null) : null));
  const source = useBarDrag((s) => (s.windowId === windowId ? s.source : null));
  const spot = useBarDrag((s) => (s.windowId === windowId ? s.spot : null));
  const zone = `menu:${panel.key}:${level}`;
  const [height, setHeight] = useState<number | null>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const place = placeMenu(panel, layer, size.menuWidth, height, size);
  const appear = usePopoverMotion(closing, onClosed, height !== null && contentHeight !== null);
  const motion = usePopoverMotionStyle(appear, "top left");
  const frames = useRef(new Map<string, { y: number; height: number }>());
  const views = useRef(new Map<string, View>());
  const scrollY = useRef(0);

  const draggedHere = source?.kind === "bookmark" && ids.includes(source.id) ? source.id : null;
  const slotHere = spot && "slot" in spot && spot.zone === zone ? spot.slot - fromIndex : null;
  const offsets = source ? roomOffsets(ids, draggedHere, slotHere, size.menuRow) : ids.map(() => 0);
  const lineY = slotHere === null ? null : menuLineY(ids, frames.current, offsets, draggedHere, slotHere, size.menuRow);

  const openChild = (id: string, sprung = false) =>
    void measureRect(views.current.get(id) ?? null).then((anchor) => anchor && openFolderMenu(windowId, { parentId: id, fromIndex: 0, anchor, level: level + 1 }, { sprung }));

  const latest = useRef({ ids, place, closing, retained: panel.retained, openChild });
  latest.current = { ids, place, closing, retained: panel.retained, openChild };
  useEffect(
    () =>
      registerDropZone(zone, {
        windowId,
        depth: level + 1,
        resolve: (x, y, draggedId) => {
          const L = latest.current;
          const r = L.place;
          if (L.closing || L.retained || x < r.x || x > r.x + r.width || y < r.y || y > r.y + (height ?? 0)) return undefined;
          const nodes = currentBookmarks().nodes;
          const items = L.ids.flatMap((id) => {
            const f = frames.current.get(id);
            return f ? [{ id, start: f.y, size: f.height, folder: nodes[id]?.kind === "folder" }] : [];
          });
          const hit = zoneHitAt(items, y - r.y + scrollY.current, draggedId && L.ids.includes(draggedId) ? draggedId : null);
          if ("into" in hit) return { spot: hit, springOpen: () => latest.current.openChild(hit.into, true) };
          return { spot: { parentId, slot: fromIndex + hit.slot, zone } };
        },
      }),
    [windowId, zone, height],
  );

  return (
    <Animated.View
      pointerEvents={closing || panel.retained ? "none" : "auto"}
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
      style={{ position: "absolute", left: place.x - layer.x, top: place.y - layer.y, width: place.width, ...motion, ...(panel.retained ? HIDDEN : null) }}
    >
      <PopoverSurface>
        <ScrollView
          showsVerticalScrollIndicator={false}
          style={{ height: contentHeight === null ? undefined : Math.min(contentHeight + (slotHere !== null && !draggedHere ? size.menuRow : 0), place.maxHeight - (footer?.links ? FOOTER_ROWS * size.menuRow + PAD * 2 : 0)) }}
          contentContainerStyle={{ paddingVertical: PAD }}
          onContentSizeChange={(_, h) => setContentHeight(h)}
          scrollEventThrottle={16}
          onScroll={(e) => (scrollY.current = e.nativeEvent.contentOffset.y)}
        >
          {ids.map((id, i) => (
            <FolderRow
              key={id}
              id={id}
              windowId={windowId}
              profileId={profileId}
              panel={panel}
              size={size}
              offset={offsets[i] ?? 0}
              open={childOpen === id}
              onOpenChild={openChild}
              onView={(v) => (v ? views.current.set(id, v) : views.current.delete(id))}
              onFrame={(f) => frames.current.set(id, f)}
            />
          ))}
          {ids.length === 0 && (
            <RowFrame size={size}>
              <Text size="body" tone="textTertiary">
                Empty
              </Text>
            </RowFrame>
          )}
          <MenuLine y={lineY} />
        </ScrollView>
        {footer && footer.links > 0 && (
          <View style={{ paddingBottom: PAD }}>
            <MenuSeparator />
            {openAllItems(footer.links).map((item) =>
              "id" in item ? (
                <ActionRow
                  key={item.id}
                  size={size}
                  symbol={item.symbol}
                  title={item.title}
                  onPress={() => {
                    closeFolderMenus();
                    void openFolder(parentId, windowId, openAllModeOf(item.id) ?? "tabs");
                  }}
                />
              ) : null,
            )}
            <ActionRow
              size={size}
              symbol="sidebar.left"
              title="Add to Sidebar as Group"
              disabled={!footer.group}
              onPress={() => {
                closeFolderMenus();
                addFolderToSidebar(parentId, windowId);
              }}
            />
          </View>
        )}
      </PopoverSurface>
    </Animated.View>
  );
}

const FOOTER_ROWS = 4;
const HIDDEN = { opacity: 0 } as const;

function menuLineY(ids: string[], frames: Map<string, { y: number; height: number }>, offsets: number[], dragged: string | null, slot: number, room: number): number {
  for (let i = slot; i < ids.length; i++) {
    const f = ids[i] === dragged ? undefined : frames.get(ids[i]!);
    if (f) return f.y + offsets[i]! - room / 2;
  }
  for (let i = Math.min(slot, ids.length) - 1; i >= 0; i--) {
    const f = ids[i] === dragged ? undefined : frames.get(ids[i]!);
    if (f) return f.y + f.height + offsets[i]! + room / 2;
  }
  return PAD + room / 2;
}

function MenuLine({ y }: { y: number | null }) {
  const theme = useTheme();
  const shown = useEased(y !== null);
  const top = useSlide(y ?? 0);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: FAVICON_LEFT,
        right: PANEL.inset,
        top: -bookmarksBar.dropLine / 2,
        height: bookmarksBar.dropLine,
        borderRadius: bookmarksBar.dropLineRadius,
        backgroundColor: theme.accent,
        opacity: shown,
        transform: [{ translateY: top }],
      }}
    />
  );
}

function RowFrame({ size, children, plate = false, pressed = false, ring = false }: { size: BarSize; children: ReactNode; plate?: boolean; pressed?: boolean; ring?: boolean }) {
  const theme = useTheme();
  const fill = useEased(plate || pressed);
  const ringOpacity = useEased(ring);
  const shape = { borderRadius: PANEL.rowRadius, borderCurve: "continuous" } as const;
  return (
    <View style={{ height: size.menuRow, marginHorizontal: PANEL.rowInset, paddingHorizontal: PANEL.rowPadding, flexDirection: "row", alignItems: "center", gap: PANEL.iconGap }}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, shape, { opacity: fill, backgroundColor: menuRowFill(theme, pressed) }]} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, shape, { opacity: ringOpacity, borderWidth: bookmarksBar.dropRing, borderColor: theme.accent }]} />
      {children}
    </View>
  );
}

function ActionRow({ size, symbol, title, onPress, disabled }: { size: BarSize; symbol?: string; title: string; onPress: () => void; disabled?: boolean }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <View onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={disabled ? DISABLED : undefined} pointerEvents={disabled ? "none" : "auto"}>
      <Pressable onPress={onPress}>
        {({ pressed }) => (
          <RowFrame size={size} plate={hovered} pressed={pressed}>
            <View style={ICON_SLOT}>{symbol ? <Symbol name={symbol} size={PANEL.iconSize} color={theme.icon} style={ICON_SLOT} /> : null}</View>
            <Text size="body" lines={1} style={TITLE}>
              {title}
            </Text>
          </RowFrame>
        )}
      </Pressable>
    </View>
  );
}

function FolderRow({
  id,
  windowId,
  profileId,
  panel,
  size,
  offset,
  open,
  onOpenChild,
  onView,
  onFrame,
}: {
  id: string;
  windowId: string;
  profileId: string;
  panel: FolderMenuPanel;
  size: BarSize;
  offset: number;
  open: boolean;
  onOpenChild: (id: string) => void;
  onView: (view: View | null) => void;
  onFrame: (frame: { y: number; height: number }) => void;
}) {
  const theme = useTheme();
  const node = useBookmarks((b) => b.nodes[id]);
  const view = useRef<View | null>(null);
  const [hovered, setHovered] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragging = useBarDrag((s) => s.source?.kind === "bookmark" && s.source.id === id);
  const anyDrag = useBarDrag((s) => !!s.source);
  const dropInto = useBarDrag((s) => !!s.spot && "into" in s.spot && s.spot.into === id);
  const sidebarEdge = useSidebarEdge(windowId, useSidebarWidth(windowId));
  const edge = useRef(sidebarEdge);
  edge.current = sidebarEdge;
  const shift = useSlide(offset);
  const responder = useBookmarkDragResponder(view, () => ({ windowId, id, panel: panel.key, sidebarEdge: edge.current }), [windowId, id, panel.key]);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  if (!node) return null;
  const folder = node.kind === "folder";
  const enter = () => {
    setHovered(true);
    clearTimeout(hoverTimer.current);
    if (anyDrag) return;
    hoverTimer.current = setTimeout(() => (folder ? onOpenChild(id) : closeMenusAbove(windowId, panel.level)), folderMenu.hoverOpenMs);
  };
  const press = (e: { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; middle?: boolean }) => {
    if (node.kind === "folder") return onOpenChild(id);
    const mode = openModeFor(e);
    if (mode !== "background") closeFolderMenus();
    openUrl(node.url, windowId, mode);
  };
  return (
    <Animated.View
      ref={(v: View | null) => {
        view.current = v;
        onView(v);
      }}
      collapsable={false}
      {...responder.panHandlers}
      onLayout={(e) => onFrame({ y: e.nativeEvent.layout.y, height: e.nativeEvent.layout.height })}
      onMouseEnter={enter}
      onMouseLeave={() => {
        setHovered(false);
        clearTimeout(hoverTimer.current);
      }}
      style={{ opacity: dragging ? 0 : 1, transform: [{ translateY: shift }] }}
    >
      <ContextMenuArea onContextMenu={() => void openBarMenu(windowId, profileId, node)}>
        <MouseArea onMiddleClick={(e) => press({ ...e, middle: true })}>
          <View tooltip={node.kind === "url" ? node.url : undefined}>
            <Pressable accessibilityRole="menuitem" accessibilityLabel={node.title || (node.kind === "url" ? node.url : "")} onPress={(e) => press(modifiersOf(e))}>
              {({ pressed }) => (
                <RowFrame size={size} plate={(hovered && !anyDrag) || open || dropInto} pressed={pressed} ring={dropInto}>
                  <View style={ICON_SLOT}>
                    <ChipIcon size={MENU_ICON} favicon={node.kind === "url" ? node : undefined} icon={folder ? "folder" : undefined} />
                  </View>
                  <Text size="body" lines={1} style={TITLE}>
                    {node.title || (node.kind === "url" ? node.url : "")}
                  </Text>
                  {folder ? <Symbol name="chevron.right" size={PANEL.subtitleSize - 1} weight="semibold" color={theme.textSecondary} style={CHEVRON} /> : null}
                </RowFrame>
              )}
            </Pressable>
          </View>
        </MouseArea>
      </ContextMenuArea>
    </Animated.View>
  );
}

const MENU_ICON: IconMetrics = { favicon: folderMenu.favicon, icon: PANEL.iconSize, iconBox: PANEL.iconSlot };
const ICON_SLOT = { width: PANEL.iconSlot, height: PANEL.iconSlot, alignItems: "center", justifyContent: "center" } as const;
const TITLE = { flex: 1 } as const;
const CHEVRON = { width: folderMenu.chevronBox, height: folderMenu.chevronBox } as const;
const DISABLED = { opacity: opacity.disabled } as const;
