import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { folderChildren, type RemovedBookmarks } from "../../state/bookmarks/bookmarks";
import { useTab } from "../../state/browser/hooks";
import { currentBookmarks } from "../../state/browser/current";
import { useBookmarkRoots, useBookmarks } from "../../state/bookmarks/hooks";
import { plural } from "../../state/browser/model";
import type { BookmarkNode, Bookmarks } from "../../state/browser/types";
import { moveBookmark, openFolder, removeBookmarks, restoreBookmarks } from "../../state/bookmarks/actions";
import { FolderTree } from "../bookmarks/FolderTree";
import { Box, Button, radius, space, Symbol, Text, useTheme } from "../ui";
import { openOrganizeMenu } from "../../state/bookmarks/bookmarkMenus";
import { BookmarkRow } from "./BookmarkRow";
import { DropTargets } from "./dropTargets";
import { EmptyState, matchesQuery, PageHeader } from "./PageLayout";
import { bookmarkList, pagesColors, undoToast } from "./tokens";
import { UndoToast } from "./UndoToast";


type Target = { kind: "folder"; id: string } | { kind: "row"; id: string; index: number; folder: boolean };
type Drop = { into: string } | { parentId: string; index: number };

export function BookmarksPage({ tabId, profileId }: { tabId: string; profileId: string }) {
  const theme = useTheme();
  const colors = theme.dark ? pagesColors.dark : pagesColors.light;
  const windowId = useTab(tabId, (t) => t?.windowId ?? "");
  const roots = useBookmarkRoots(profileId);
  const [folderId, setFolderId] = useState<string | null>(roots?.bar ?? null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [undo, setUndo] = useState<{ removed: RemovedBookmarks; count: number } | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const anchor = useRef<string | null>(null);
  const targets = useMemo(() => new DropTargets<Target>(), []);

  const folderExists = useBookmarks((b) => !!folderId && b.nodes[folderId]?.kind === "folder");
  useEffect(() => {
    if (!folderExists && roots) setFolderId(roots.bar);
  }, [folderExists, roots]);
  useEffect(() => setSelected([]), [folderId, query]);

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

  const select = (id: string, e: { metaKey?: boolean; shiftKey?: boolean }) => {
    if (e.shiftKey && anchor.current && ids.includes(anchor.current)) {
      const [a, b] = [ids.indexOf(anchor.current), ids.indexOf(id)].sort((x, y) => x - y);
      setSelected(ids.slice(a!, b! + 1));
      return;
    }
    anchor.current = id;
    if (e.metaKey) setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    else setSelected([id]);
  };

  const remove = (list: string[]) => {
    if (!list.length) return;
    const removed = removeBookmarks(list);
    setSelected([]);
    setUndo({ removed, count: removed.places.length });
  };
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), undoToast.visibleMs);
    return () => clearTimeout(timer);
  }, [undo]);

  const dragging = useRef<string[]>([]);
  const onDragStart = (id: string) => {
    dragging.current = selected.includes(id) ? ids.filter((x) => selected.includes(x)) : [id];
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
      <PageHeader title="Bookmarks" query={query} onQuery={setQuery} placeholder="Search bookmarks" actions={actions} />
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
                style={{ borderRadius: radius.m, backgroundColor: drop && "into" in drop && drop.into === id ? colors.dropTarget : undefined }}
              >
                {row}
              </View>
            )}
          />
        </ScrollView>
        <Box radius="panel" fill="groupFill" border="groupBorder" style={LIST_CARD}>
          <Box row padX="lx" gap="m" style={LIST_HEADER}>
            <Text lines={1} weight="semibold" style={LIST_TITLE}>
              {searching ? `Results for “${query.trim()}”` : folderTitle}
            </Text>
            {!searching && folderId && (
              <Button title="Open All" onPress={() => void openFolder(folderId, windowId)} disabled={!ids.length} />
            )}
          </Box>
          <View style={[SEPARATOR, { backgroundColor: theme.divider }]} />
          {ids.length === 0 ? (
            <EmptyState
              icon={<Symbol name={searching ? "magnifyingglass" : "bookmark"} size={bookmarkList.emptyIcon} color={theme.textTertiary} style={EMPTY_ICON} />}
              title={searching ? "No search results found" : "This folder is empty"}
            />
          ) : (
            <ScrollView
              focusable
              enableFocusRing={false}
              keyDownEvents={[{ key: "Backspace" }, { key: "Delete" }, { key: "a", metaKey: true }]}
              onKeyDown={(e) => {
                const key = e.nativeEvent.key;
                if (key === "Backspace" || key === "Delete") remove(selected);
                if (key === "a") setSelected(ids);
              }}
              contentContainerStyle={LIST_CONTENT}
            >
              {ids.map((id, index) => (
                <View key={id}>
                  {indicator === index && <DropLine color={theme.formAccent} />}
                  <BookmarkRow
                    id={id}
                    windowId={windowId}
                    profileId={profileId}
                    showPath={searching}
                    selected={selected.includes(id)}
                    highlighted={!!drop && "into" in drop && drop.into === id}
                    targetRef={targets.ref(`row:${id}`, { kind: "row", id, index, folder: currentBookmarks().nodes[id]?.kind === "folder" })}
                    onSelect={(e) => select(id, e)}
                    onOpenFolder={(folder = id) => {
                      setQuery("");
                      setFolderId(folder);
                    }}
                    onDelete={() => remove(selected.includes(id) ? selected : [id])}
                    menuSelection={() => ids.filter((x) => selected.includes(x))}
                    onDragStart={() => onDragStart(id)}
                    onDragMove={onDragMove}
                    onDragEnd={onDragEnd}
                  />
                </View>
              ))}
              {indicator === ids.length && <DropLine color={theme.formAccent} />}
            </ScrollView>
          )}
        </Box>
      </View>
      {undo && (
        <UndoToast
          message={`${plural(undo.count, "item")} deleted`}
          onUndo={() => {
            restoreBookmarks(undo.removed);
            setUndo(null);
          }}
        />
      )}
    </View>
  );
}

function folderLinksAndFolders(b: Bookmarks, folderId: string): BookmarkNode[] {
  return folderChildren(b, folderId).flatMap((n) => (n.kind === "folder" ? [n, ...folderLinksAndFolders(b, n.id)] : [n]));
}

function DropLine({ color }: { color: string }) {
  return <View style={[DROP_LINE, { backgroundColor: color }]} />;
}

const BODY = { flex: 1, flexDirection: "row", paddingHorizontal: space.xl, paddingBottom: space.xl, gap: space.xl } as const;
const TREE = { width: bookmarkList.treeWidth, flexGrow: 0 } as const;
const TREE_CONTENT = { paddingVertical: space.xs } as const;
const LIST_CARD = { flex: 1, overflow: "hidden" } as const;
const LIST_HEADER = { height: bookmarkList.headerHeight, alignItems: "center" } as const;
const LIST_TITLE = { flex: 1 } as const;
const SEPARATOR = { height: StyleSheet.hairlineWidth * 2 } as const;
const EMPTY_ICON = { width: bookmarkList.emptyIconBox, height: bookmarkList.emptyIconBox } as const;
const LIST_CONTENT = { padding: space.s } as const;
const DROP_LINE = { height: bookmarkList.dropLine, marginHorizontal: space.m, marginVertical: -bookmarkList.dropLine / 2, borderRadius: bookmarkList.dropLineRadius, zIndex: 5 } as const;
