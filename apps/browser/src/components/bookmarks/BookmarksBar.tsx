import { memo, useState } from "react";
import { Animated, StyleSheet, View, type LayoutRectangle } from "react-native";
import { folderChildren } from "../../state/bookmarks/bookmarks";
import { currentBookmarks } from "../../state/browser/current";
import { useBookmarkProfileId, useBookmarks } from "../../state/bookmarks/hooks";
import { useSettings, useWindowId } from "../../state/browser/hooks";
import { moveBookmark } from "../../state/bookmarks/actions";
import type { Settings } from "../../state/settings/settings";
import { ContextMenuArea, space, Text, useTheme } from "../ui";
import { ThemeContext } from "../ui/theme";
import { siteScopedTheme, useEasedColor } from "../ui/toolbarColors";
import { useSitePalette } from "../toolbar/useSitePalette";
import { BarButton, BarItem, ImportButton } from "./BarItem";
import { openBarMenu, openFolderMenu } from "../../state/bookmarks/barMenus";
import { bookmarksBar } from "./tokens";

export const BOOKMARKS_BAR_HEIGHT = bookmarksBar.height;

export const BookmarksBar = memo(function BookmarksBar({ tabId, placeholder }: { tabId: string; placeholder?: boolean }) {
  const windowId = useWindowId();
  return placeholder ? <View style={{ height: BOOKMARKS_BAR_HEIGHT }} /> : <SiteColoredBar windowId={windowId} tabId={tabId} />;
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

function Bar({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const profileId = useBookmarkProfileId(windowId);
  const barId = useBookmarks((b) => b.roots[profileId]?.bar);
  const otherId = useBookmarks((b) => b.roots[profileId]?.other);
  const children = useBookmarks((b) => {
    const bar = barId ? b.nodes[barId] : undefined;
    return bar?.kind === "folder" ? bar.children : EMPTY;
  });
  const hasOther = useBookmarks((b) => {
    const other = otherId ? b.nodes[otherId] : undefined;
    return other?.kind === "folder" && other.children.length > 0;
  });
  const hideImport = useSettings((s) => s.hideBookmarksBarImport);

  const [width, setWidth] = useState(0);
  const [frames, setFrames] = useState<Record<string, LayoutRectangle>>({});
  const [drop, setDrop] = useState<{ index: number; into: string | null } | null>(null);

  const reserved = hasOther ? bookmarksBar.otherReserve : 0;
  const available = width - reserved;
  const fits = (id: string) => {
    const f = frames[id];
    return !f || f.x + f.width <= available - (overflowing() ? bookmarksBar.overflowWidth : 0);
  };
  function overflowing() {
    const last = children.at(-1);
    const f = last ? frames[last] : undefined;
    return !!f && f.x + f.width > available;
  }
  const hidden = children.filter((id) => !fits(id));

  const dropAt = (id: string, dx: number): { index: number; into: string | null } | null => {
    const f = frames[id];
    if (!f || !barId) return null;
    const x = f.x + f.width / 2 + dx;
    const visible = children.filter((c) => frames[c] && fits(c));
    for (let i = 0; i < visible.length; i++) {
      const c = visible[i]!;
      const r = frames[c]!;
      const node = currentBookmarks().nodes[c];
      if (c !== id && node?.kind === "folder" && x > r.x + r.width * 0.25 && x < r.x + r.width * 0.75) return { index: -1, into: c };
      if (x < r.x + r.width / 2) return { index: children.indexOf(c), into: null };
    }
    return { index: children.length, into: null };
  };

  const onDrop = (id: string, target: { index: number; into: string | null } | null) => {
    setDrop(null);
    if (!target || !barId) return;
    if (target.into) return moveBookmark(id, target.into);
    const from = children.indexOf(id);
    moveBookmark(id, barId, target.index > from ? target.index - 1 : target.index);
  };

  const indicatorX = (() => {
    if (!drop || drop.into) return null;
    const id = children[drop.index];
    const f = id ? frames[id] : frames[children.at(-1) ?? ""];
    if (!f) return bookmarksBar.dropLineStart;
    return id ? f.x - bookmarksBar.dropLineGap : f.x + f.width + bookmarksBar.dropLineGap;
  })();

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={BAR}
    >
      <ContextMenuArea onContextMenu={() => void openBarMenu(windowId, profileId, null)} style={StyleSheet.absoluteFill} />
      <View style={ITEMS}>
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
              highlighted={drop?.into === id}
              onLayout={(r) => setFrames((prev) => (sameRect(prev[id], r) ? prev : { ...prev, [id]: r }))}
              onDragMove={(dx) => setDrop(Number.isFinite(dx) ? dropAt(id, dx) : null)}
              onDragEnd={(dx) => onDrop(id, dropAt(id, dx))}
            />
          ))
        )}
        {indicatorX !== null && (
          <View style={[DROP_LINE, { left: indicatorX, backgroundColor: theme.accent }]} />
        )}
      </View>
      {hidden.length > 0 && (
        <BarButton
          icon="chevron.right.2"
          tooltip="More bookmarks"
          onPress={(e) => void openFolderMenu(windowId, hidden, e)}
          width={bookmarksBar.overflowWidth}
        />
      )}
      {hasOther && otherId && (
        <View style={OTHER}>
          <View style={[DIVIDER, { backgroundColor: theme.divider }]} />
          <BarButton
            icon="folder"
            title="Other Bookmarks"
            onPress={(e) => void openFolderMenu(windowId, folderChildren(currentBookmarks(), otherId).map((n) => n.id), e, otherId)}
          />
        </View>
      )}
    </View>
  );
}

const EMPTY: string[] = [];

const sameRect = (a: LayoutRectangle | undefined, b: LayoutRectangle) => !!a && a.x === b.x && a.width === b.width;

const BAR = { height: bookmarksBar.height, flexDirection: "row", alignItems: "center", paddingHorizontal: space.m } as const;
const ITEMS = { flex: 1, height: bookmarksBar.item, flexDirection: "row", alignItems: "center", overflow: "hidden" } as const;
const HINT = { marginLeft: space.xs } as const;
const DROP_LINE = {
  position: "absolute",
  top: bookmarksBar.dropLineInset,
  bottom: bookmarksBar.dropLineInset,
  width: bookmarksBar.dropLine,
  borderRadius: bookmarksBar.dropLineRadius,
} as const;
const OTHER = { flexDirection: "row", alignItems: "center" } as const;
const DIVIDER = { width: StyleSheet.hairlineWidth * 2, height: bookmarksBar.dividerHeight, marginHorizontal: space.s } as const;
