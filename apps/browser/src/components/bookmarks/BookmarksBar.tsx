import { memo, useEffect, useId, useRef, useState } from "react";
import { Animated, StyleSheet, View, type LayoutRectangle } from "react-native";
import { currentBookmarks } from "../../state/browser/current";
import { useBookmarkProfileId, useBookmarkRoots, useBookmarks } from "../../state/bookmarks/hooks";
import { useSettings, useWindowId } from "../../state/browser/hooks";
import { dropLinksAt, linkDragAt, linkDragLeft, registerDropZone, useBarDrag } from "../../state/bookmarks/barDrag";
import { roomOffsets, zoneHitAt } from "../../state/bookmarks/barDrop";
import { openFolderMenu, toggleFolderMenu, useFolderMenus, type MenuRect } from "../../state/bookmarks/folderMenus";
import type { Settings } from "../../state/settings/settings";
import { ContextMenuArea, FileDropArea, space, Text, useTheme, type DropUpdate } from "../ui";
import { ThemeContext } from "../ui/theme";
import { siteScopedTheme, useEasedColor } from "../ui/toolbarColors";
import { useSitePalette } from "../toolbar/useSitePalette";
import { BarButton, BarItem, ImportButton } from "./BarItem";
import { measureRect, useEased, useSlide } from "./barMotion";
import { openBarMenu } from "../../state/bookmarks/barMenus";
import { useBarSize, useBookmarksBarHeight } from "./barSize";
import { bookmarksBar, type BarSize } from "./tokens";

export const BookmarksBar = memo(function BookmarksBar({ tabId, placeholder }: { tabId: string; placeholder?: boolean }) {
  const windowId = useWindowId();
  const height = useBookmarksBarHeight();
  return placeholder ? <View style={{ height }} /> : <SiteColoredBar windowId={windowId} tabId={tabId} />;
});

function SiteColoredBar({ windowId, tabId }: { windowId: string; tabId: string }) {
  const theme = useTheme();
  const palette = useSitePalette(tabId);
  const band = useEasedColor(palette.background);
  return (
    <ThemeContext.Provider value={siteScopedTheme(theme, palette)}>
      <View>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: band }]} />
        <Bar windowId={windowId} />
      </View>
    </ThemeContext.Provider>
  );
}

export function bookmarksBarShown(mode: BookmarksBarMode, tab: { url: string } | undefined): boolean {
  if (!tab || mode === "never") return false;
  return mode === "always" || !tab.url;
}

export type BookmarksBarMode = Settings["bookmarksBar"];

type Frames = Record<string, LayoutRectangle>;

function Bar({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const size = useBarSize();
  const zone = useId();
  const profileId = useBookmarkProfileId(windowId);
  const roots = useBookmarkRoots(profileId);
  const barId = roots?.bar;
  const otherId = roots?.other;
  const children = useBookmarks((b) => {
    const bar = barId ? b.nodes[barId] : undefined;
    return bar?.kind === "folder" ? bar.children : EMPTY;
  });
  const hasOther = useBookmarks((b) => {
    const other = otherId ? b.nodes[otherId] : undefined;
    return other?.kind === "folder" && other.children.length > 0;
  });
  const hideImport = useSettings((s) => s.hideBookmarksBarImport);
  const source = useBarDrag((s) => (s.windowId === windowId ? s.source : null));
  const spot = useBarDrag((s) => (s.windowId === windowId ? s.spot : null));
  const otherOpen = useFolderMenus((s) => s.windowId === windowId && !!otherId && s.panels.some((p) => p.level === 0 && !p.retained && p.key === otherId));

  const root = useRef<View | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const otherButton = useRef<View | null>(null);
  const overflowButton = useRef<View | null>(null);
  const [width, setWidth] = useState(0);
  const [itemsFrame, setItemsFrame] = useState<LayoutRectangle>({ x: 0, y: 0, width: 0, height: 0 });
  const [frames, setFrames] = useState<Frames>({});
  const [otherX, setOtherX] = useState<number | null>(null);

  const reserved = hasOther ? bookmarksBar.otherReserve : 0;
  const available = width - reserved;
  const lastFrame = frames[children.at(-1) ?? ""];
  const overflowing = !!lastFrame && lastFrame.x + lastFrame.width > available;
  const fits = (id: string) => {
    const f = frames[id];
    return !f || f.x + f.width <= available - (overflowing ? bookmarksBar.overflowWidth : 0);
  };
  const visible = children.filter(fits);
  const hiddenFrom = visible.length;

  const draggedHere = source?.kind === "bookmark" && visible.includes(source.id) ? source.id : null;
  const slotHere = spot && "slot" in spot && spot.zone === zone ? spot.slot : null;
  const roomWidth = draggedHere ? (frames[draggedHere]?.width ?? 0) + size.itemGap : size.item * 2;
  const offsets = source ? roomOffsets(visible, draggedHere, slotHere, roomWidth) : visible.map(() => 0);
  const lineX = slotHere === null ? null : dropLineX(visible, frames, offsets, draggedHere, slotHere, roomWidth);

  const measureOrigin = () => root.current?.measureInWindow((x, y) => (origin.current = { x, y }));
  useEffect(() => {
    if (source) measureOrigin();
  }, [!!source]);

  const latest = useRef({ barId, otherId, visible, frames, itemsFrame, otherX, width, size });
  latest.current = { barId, otherId, visible, frames, itemsFrame, otherX, width, size };
  useEffect(
    () =>
      registerDropZone(zone, {
        windowId,
        depth: 0,
        resolve: (x, y, draggedId) => {
          const { x: ox, y: oy } = origin.current;
          const L = latest.current;
          if (!L.barId || x < ox || x > ox + L.width || y < oy || y > oy + L.size.height) return undefined;
          const local = x - ox;
          if (L.otherId && L.otherX !== null && local >= L.otherX) {
            const otherId = L.otherId;
            return { spot: { into: otherId }, springOpen: () => void openFrom(windowId, otherButton.current, otherId, 0) };
          }
          const nodes = currentBookmarks().nodes;
          const items = L.visible.flatMap((id) => {
            const f = L.frames[id];
            return f ? [{ id, start: L.itemsFrame.x + f.x, size: f.width, folder: nodes[id]?.kind === "folder" }] : [];
          });
          const hit = zoneHitAt(items, local, draggedId && L.visible.includes(draggedId) ? draggedId : null, L.size.itemGap);
          if (!("into" in hit)) return { spot: { parentId: L.barId, slot: Math.min(hit.slot, L.visible.length), zone } };
          const f = L.frames[hit.into]!;
          const anchor = { x: ox + L.itemsFrame.x + f.x, y: oy + L.itemsFrame.y + f.y, width: f.width, height: f.height };
          return { spot: hit, springOpen: () => openFolderMenu(windowId, { parentId: hit.into, fromIndex: 0, anchor, level: 0 }, { sprung: true }) };
        },
      }),
    [windowId, zone],
  );

  const onDropUpdate = (e: DropUpdate) => {
    const point = (o: { x: number; y: number }) => [o.x + e.x, o.y + e.y] as const;
    if (e.phase === "exit") return linkDragLeft();
    if (e.phase === "drop") {
      const [x, y] = point(origin.current);
      const urls = e.items.flatMap((i) => (i.kind === "text" ? [] : [i.url]));
      const text = e.items.find((i) => i.kind === "text")?.text ?? null;
      dropLinksAt(windowId, x, y, urls.map((url) => ({ url, text: urls.length === 1 ? text : null })));
      return;
    }
    if (e.phase === "enter") return void measureRect(root.current).then((r) => r && ((origin.current = r), linkDragAt(windowId, ...point(r))));
    linkDragAt(windowId, ...point(origin.current));
  };

  return (
    <FileDropArea
      ref={root}
      onLayout={(e) => {
        setWidth(e.nativeEvent.layout.width);
        measureOrigin();
      }}
      onDropUpdate={onDropUpdate}
      style={{ height: size.height, flexDirection: "row", alignItems: "center", paddingHorizontal: space.m }}
    >
      <ContextMenuArea onContextMenu={() => void openBarMenu(windowId, profileId, null)} style={StyleSheet.absoluteFill} />
      <View onLayout={(e) => setItemsFrame(e.nativeEvent.layout)} style={{ flex: 1, height: size.item, flexDirection: "row", alignItems: "center", overflow: "hidden" }}>
        {children.length === 0 && !hideImport ? (
          <ImportButton />
        ) : children.length === 0 ? (
          <Text size="small" tone="textTertiary" style={HINT}>
            For quick access, place your bookmarks here on the bookmarks bar.
          </Text>
        ) : (
          children.map((id) => (
            <BarItem
              key={id}
              id={id}
              windowId={windowId}
              profileId={profileId}
              hidden={!fits(id)}
              offset={offsets[visible.indexOf(id)] ?? 0}
              onLayout={(r) => setFrames((prev) => (sameRect(prev[id], r) ? prev : { ...prev, [id]: r }))}
            />
          ))
        )}
        <DropLine x={lineX} size={size} color={theme.accent} />
      </View>
      {hiddenFrom < children.length && barId && (
        <BarButton
          ref={overflowButton}
          icon="chevron.right.2"
          tooltip="More bookmarks"
          onPress={() => void openFrom(windowId, overflowButton.current, barId, hiddenFrom, true)}
          width={bookmarksBar.overflowWidth}
        />
      )}
      {hasOther && otherId && (
        <View style={OTHER} onLayout={(e) => setOtherX(e.nativeEvent.layout.x)}>
          <View style={[DIVIDER, { backgroundColor: theme.divider }]} />
          <BarButton
            ref={otherButton}
            icon="folder"
            title="Other Bookmarks"
            active={otherOpen}
            dropRing={!!spot && "into" in spot && spot.into === otherId}
            onPress={() => void openFrom(windowId, otherButton.current, otherId, 0, true)}
          />
        </View>
      )}
    </FileDropArea>
  );
}

async function openFrom(windowId: string, view: View | null, parentId: string, fromIndex: number, toggle = false) {
  const anchor: MenuRect | null = await measureRect(view);
  if (!anchor) return;
  if (toggle) toggleFolderMenu(windowId, { parentId, fromIndex, anchor });
  else openFolderMenu(windowId, { parentId, fromIndex, anchor, level: 0 }, { sprung: true });
}

function dropLineX(ids: string[], frames: Frames, offsets: number[], dragged: string | null, slot: number, room: number): number {
  for (let i = slot; i < ids.length; i++) {
    if (ids[i] === dragged) continue;
    const f = frames[ids[i]!];
    if (f) return f.x + offsets[i]! - room / 2;
  }
  for (let i = Math.min(slot, ids.length) - 1; i >= 0; i--) {
    if (ids[i] === dragged) continue;
    const f = frames[ids[i]!];
    if (f) return f.x + f.width + offsets[i]! + room / 2;
  }
  return room / 2;
}

function DropLine({ x, size, color }: { x: number | null; size: BarSize; color: string }) {
  const shown = useEased(x !== null);
  const left = useSlide(x ?? 0);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: bookmarksBar.dropLineInset,
        height: size.item - bookmarksBar.dropLineInset * 2,
        width: bookmarksBar.dropLine,
        marginLeft: -bookmarksBar.dropLine / 2,
        borderRadius: bookmarksBar.dropLineRadius,
        backgroundColor: color,
        opacity: shown,
        transform: [{ translateX: left }],
      }}
    />
  );
}

const EMPTY: string[] = [];

const sameRect = (a: LayoutRectangle | undefined, b: LayoutRectangle) => !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

const HINT = { marginLeft: space.xs } as const;
const OTHER = { flexDirection: "row", alignItems: "center" } as const;
const DIVIDER = { width: StyleSheet.hairlineWidth * 2, height: bookmarksBar.dividerHeight, marginHorizontal: space.s } as const;
