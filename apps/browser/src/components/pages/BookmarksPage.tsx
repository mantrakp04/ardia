import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, ScrollView, View } from "react-native";
import { folderChildren, type RemovedBookmarks } from "../../state/bookmarks/bookmarks";
import { useTab } from "../../state/browser/hooks";
import { currentBookmarks } from "../../state/browser/current";
import { useBookmarkRoots, useBookmarks } from "../../state/bookmarks/hooks";
import { plural } from "../../state/browser/model";
import type { BookmarkNode, Bookmarks } from "../../state/browser/types";
import { moveBookmark, openFolder, removeBookmarks, restoreBookmarks } from "../../state/bookmarks/actions";
import { clickSelection, NO_SELECTION, rowWindow, selectAll, selectedInOrder, type ListSelection } from "../../state/bookmarks/bookmarkList";
import { FolderTree } from "../bookmarks/FolderTree";
import { Box, Button, Divider, EmptyState, radius, space, Text, Toast, useTheme } from "../ui";
import { openOrganizeMenu } from "../../state/bookmarks/bookmarkMenus";
import { BookmarkRow } from "./BookmarkRow";
import { DropTargets } from "./dropTargets";
import { matchesQuery, PageHeader } from "./PageLayout";
import { bookmarkList, pagesColors, undoToast } from "./tokens";


type Target = { kind: "folder"; id: string } | { kind: "row"; id: string; index: number; folder: boolean };
type Drop = { into: string } | { parentId: string; index: number };

export function BookmarksPage({ tabId, profileId }: { tabId: string; profileId: string }) {
  const theme = useTheme();
  const colors = pagesColors(theme);
  const windowId = useTab(tabId, (t) => t?.windowId ?? "");
  const roots = useBookmarkRoots(profileId);
  const [folderId, setFolderId] = useState<string | null>(roots?.bar ?? null);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<ListSelection>(NO_SELECTION);
  const [undo, setUndo] = useState<{ removed: RemovedBookmarks; count: number } | null>(null);
  const [undoClosing, setUndoClosing] = useState(false);
  const [drop, setDrop] = useState<Drop | null>(null);
  const targets = useMemo(() => new DropTargets<Target>(), []);

  const folderExists = useBookmarks((b) => !!folderId && b.nodes[folderId]?.kind === "folder");
  useEffect(() => {
    if (!folderExists && roots) setFolderId(roots.bar);
  }, [folderExists, roots]);
  useEffect(() => setSelection(NO_SELECTION), [folderId, query]);

  const folderTitle = useBookmarks((b) => (folderId ? (b.nodes[folderId]?.title ?? "") : ""));
  const listKey = useBookmarks((b) => {
    if (query.trim() && roots) {
      const all = [...folderLinksAndFolders(b, roots.bar), ...folderLinksAndFolders(b, roots.other)];
      return all
        .filter((n) => matchesQuery(query, n.title, n.kind === "url" ? n.url : ""))
        .map((n) => n.id)
        .join(",");
    }
    const folder = folderId ? b.nodes[folderId] : undefined;
    return folder?.kind === "folder" ? folder.children.join(",") : "";
  });
  const ids = useMemo(() => (listKey ? listKey.split(",") : []), [listKey]);
  const searching = !!query.trim();
  const selected = useMemo(() => selectedInOrder(ids, selection), [ids, selection]);

  const list = useRef<View>(null);
  const select = (id: string, e: { metaKey?: boolean; shiftKey?: boolean }) => {
    setSelection((current) => clickSelection(ids, current, id, e));
    list.current?.focus();
  };

  const remove = (doomed: string[]) => {
    if (!doomed.length) return;
    const removed = removeBookmarks(doomed);
    setSelection(NO_SELECTION);
    setUndo({ removed, count: removed.places.length });
    setUndoClosing(false);
  };
  const undoRemove = () => {
    if (!undo) return;
    restoreBookmarks(undo.removed);
    setUndo(null);
  };

  const [viewport, setViewport] = useState(800);
  const [scrollY, setScrollY] = useState(0);
  const onListLayout = useCallback((e: LayoutChangeEvent) => setViewport(Math.max(bookmarkList.row, Math.round(e.nativeEvent.layout.height))), []);
  const onListScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => setScrollY(e.nativeEvent.contentOffset.y), []);
  const shown = rowWindow(ids.length, bookmarkList.row, scrollY, viewport);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndoClosing(true), undoToast.visibleMs);
    return () => clearTimeout(timer);
  }, [undo]);

  const dragging = useRef<string[]>([]);
  const onDragStart = (id: string) => {
    dragging.current = selection.selected.has(id) ? selected : [id];
    targets.measure();
  };
  const dropFor = (x: number, y: number): Drop | null => {
    const hit = targets.hit(x, y);
    if (!hit || !folderId) return null;
    const t = hit.data;
    if (t.kind === "folder") return dragging.current.includes(t.id) ? null : { into: t.id };
    if (t.folder && hit.fraction > 0.25 && hit.fraction < 0.75 && !dragging.current.includes(t.id)) return { into: t.id };
    if (searching) return null;
    return { parentId: folderId, index: hit.fraction < 0.5 ? t.index : t.index + 1 };
  };
  const onDragMove = (x: number, y: number) => {
    const next = dropFor(x, y);
    setDrop((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  };
  const onDragEnd = (x: number, y: number) => {
    const target = dropFor(x, y);
    setDrop(null);
    if (!target) return;
    const moving = dragging.current;
    if ("into" in target) return moving.forEach((id) => moveBookmark(id, target.into));
    let index = target.index;
    for (const id of moving) {
      const from = ids.indexOf(id);
      if (from >= 0 && from < target.index) index--;
    }
    moving.forEach((id, i) => moveBookmark(id, target.parentId, index + i));
  };

  const actions =
    selected.length > 0 ? (
      <>
        <Text size="small" tone="textSecondary">{`${selected.length} selected`}</Text>
        <Button title="Delete" kind="primary" onPress={() => remove(selected)} />
      </>
    ) : (
      <Button variant="icon" icon="ellipsis.circle" onPress={() => void openOrganizeMenu(windowId, profileId, folderId)} tooltip="Organize" />
    );

  const indicator = drop && "index" in drop ? drop.index : null;

  return (
    <View style={{ flex: 1 }}>
      <PageHeader title="Bookmarks" query={query} onQuery={setQuery} actions={actions} />
      <View style={BODY}>
        <ScrollView style={TREE} contentContainerStyle={TREE_CONTENT}>
          <FolderTree
            profileId={profileId}
            selectedId={searching ? null : folderId}
            onSelect={(id) => {
              setQuery("");
              setFolderId(id);
            }}
            rowHeight={bookmarkList.treeRow}
            wrapRow={(id, row) => (
              <View
                ref={targets.ref(`tree:${id}`, { kind: "folder", id })}
                style={{ borderRadius: radius.control, backgroundColor: drop && "into" in drop && drop.into === id ? colors.dropTarget : undefined }}
              >
                {row}
              </View>
            )}
          />
        </ScrollView>
        <Box radius="panel" fill="groupFill" border="groupBorder" style={LIST_CARD}>
          <Box row padX="xl" gap="m" style={LIST_HEADER}>
            <Text lines={1} weight="semibold" style={LIST_TITLE}>
              {searching ? `Results for “${query.trim()}”` : folderTitle}
            </Text>
            {!searching && folderId && (
              <Button title="Open All" onPress={() => void openFolder(folderId, windowId)} disabled={!ids.length} />
            )}
          </Box>
          <Divider thick />
          {ids.length === 0 ? (
            <EmptyState
              symbol={searching ? "magnifyingglass" : "bookmark"}
              title={searching ? "No search results found" : "This folder is empty"}
            />
          ) : (
            <View
              ref={list}
              focusable
              enableFocusRing={false}
              keyDownEvents={LIST_KEYS}
              onKeyDown={(e) => {
                const { key, metaKey } = e.nativeEvent;
                if (key === "Backspace" || key === "Delete") remove(selected);
                else if (key === "a" && metaKey) setSelection(selectAll(ids));
              }}
              style={LIST_KEYS_VIEW}
            >
              <ScrollView onLayout={onListLayout} onScroll={onListScroll} scrollEventThrottle={16} contentContainerStyle={LIST_CONTENT}>
                <View style={{ height: ids.length * bookmarkList.row }}>
                  {ids.slice(shown.first, shown.end).map((id, offset) => {
                    const index = shown.first + offset;
                    return (
                      <BookmarkRow
                        key={id}
                        id={id}
                        top={index * bookmarkList.row}
                        windowId={windowId}
                        profileId={profileId}
                        showPath={searching}
                        selected={selection.selected.has(id)}
                        highlighted={!!drop && "into" in drop && drop.into === id}
                        targetRef={targets.ref(`row:${id}`, { kind: "row", id, index, folder: currentBookmarks().nodes[id]?.kind === "folder" })}
                        onSelect={(e) => select(id, e)}
                        onOpenFolder={(folder = id) => {
                          setQuery("");
                          setFolderId(folder);
                        }}
                        onDelete={() => remove(selection.selected.has(id) ? selected : [id])}
                        menuSelection={() => selected}
                        onDragStart={() => onDragStart(id)}
                        onDragMove={onDragMove}
                        onDragEnd={onDragEnd}
                      />
                    );
                  })}
                  {indicator !== null && <DropLine top={indicator * bookmarkList.row} color={theme.formAccent} />}
                </View>
              </ScrollView>
            </View>
          )}
        </Box>
      </View>
      {undo && (
        <Toast
          title={`${plural(undo.count, "item")} deleted`}
          action="Undo"
          onAction={undoRemove}
          closing={undoClosing}
          onClosed={() => setUndo(null)}
        />
      )}
    </View>
  );
}

function folderLinksAndFolders(b: Bookmarks, folderId: string): BookmarkNode[] {
  return folderChildren(b, folderId).flatMap((n) => (n.kind === "folder" ? [n, ...folderLinksAndFolders(b, n.id)] : [n]));
}

function DropLine({ top, color }: { top: number; color: string }) {
  return <View style={[DROP_LINE, { top: top - bookmarkList.dropLine / 2, backgroundColor: color }]} />;
}

const LIST_KEYS = [{ key: "Backspace" }, { key: "Delete" }, { key: "a", metaKey: true }];

const BODY = { flex: 1, flexDirection: "row", paddingHorizontal: space.xl, paddingBottom: space.xl, gap: space.xl } as const;
const TREE = { width: bookmarkList.treeWidth, flexGrow: 0 } as const;
const TREE_CONTENT = { paddingVertical: space.xs } as const;
const LIST_CARD = { flex: 1, overflow: "hidden" } as const;
const LIST_HEADER = { height: bookmarkList.headerHeight, alignItems: "center" } as const;
const LIST_TITLE = { flex: 1 } as const;
const LIST_KEYS_VIEW = { flex: 1 } as const;
const LIST_CONTENT = { padding: space.s } as const;
const DROP_LINE = { position: "absolute", left: space.m, right: space.m, height: bookmarkList.dropLine, borderRadius: bookmarkList.dropLineRadius, zIndex: 5 } as const;
