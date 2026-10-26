import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { bookmarkAncestors, folderChildren } from "../../state/bookmarks/bookmarks";
import { useBookmarks } from "../../state/bookmarks/hooks";
import { currentBookmarks } from "../../state/browser/current";
import { radius, space, Symbol, Text, useHover, useTheme } from "../ui";
import { folderTree, folderTreeInk } from "./tokens";

type FolderRow = { id: string; title: string; depth: number; hasChildren: boolean };

function useFolderRows(profileId: string, expanded: Set<string>): FolderRow[] {
  const key = useBookmarks((b) => {
    const roots = b.roots[profileId];
    if (!roots) return "";
    const lines: string[] = [];
    const walk = (id: string, depth: number) => {
      const node = b.nodes[id];
      if (node?.kind !== "folder") return;
      const sub = folderChildren(b, id).filter((c) => c.kind === "folder");
      lines.push(JSON.stringify([id, node.title, depth, sub.length > 0]));
      if (expanded.has(id)) sub.forEach((c) => walk(c.id, depth + 1));
    };
    walk(roots.bar, 0);
    walk(roots.other, 0);
    return lines.join("\n");
  });
  return useMemo(
    () =>
      key
        ? key.split("\n").map((line) => {
            const [id, title, depth, hasChildren] = JSON.parse(line) as [string, string, number, boolean];
            return { id, title, depth, hasChildren };
          })
        : [],
    [key],
  );
}

export function FolderTree({
  profileId,
  selectedId,
  onSelect,
  rowHeight = folderTree.row,
  wrapRow,
}: {
  profileId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  rowHeight?: number;
  wrapRow?: (id: string, row: ReactNode) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(() => {
    const b = currentBookmarks();
    const roots = b.roots[profileId];
    const open = new Set<string>(roots ? [roots.bar, roots.other] : []);
    if (selectedId) for (const a of bookmarkAncestors(b, selectedId)) open.add(a.id);
    return open;
  });
  useEffect(() => {
    if (!selectedId) return;
    const hidden = bookmarkAncestors(currentBookmarks(), selectedId).filter((a) => !expanded.has(a.id));
    if (hidden.length) setExpanded((prev) => new Set([...prev, ...hidden.map((a) => a.id)]));
  }, [selectedId]);
  const rows = useFolderRows(profileId, expanded);
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <View>
      {rows.map((row) => {
        const content = (
          <FolderTreeRow
            key={row.id}
            row={row}
            height={rowHeight}
            selected={row.id === selectedId}
            expanded={expanded.has(row.id)}
            onToggle={() => toggle(row.id)}
            onSelect={() => onSelect(row.id)}
          />
        );
        return wrapRow ? <View key={row.id}>{wrapRow(row.id, content)}</View> : content;
      })}
    </View>
  );
}

function FolderTreeRow({
  row,
  height,
  selected,
  expanded,
  onToggle,
  onSelect,
}: {
  row: FolderRow;
  height: number;
  selected: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onSelect}>
        <View
          style={{
            height,
            borderRadius: radius.m,
            flexDirection: "row",
            alignItems: "center",
            paddingLeft: folderTree.inset + row.depth * folderTree.indent,
            paddingRight: space.m,
            backgroundColor: selected ? theme.formAccent : hovered ? theme.rowHover : undefined,
          }}
        >
          <Pressable onPress={onToggle} disabled={!row.hasChildren} style={{ width: folderTree.chevronBox, height, alignItems: "center", justifyContent: "center" }}>
            {row.hasChildren ? (
              <Symbol
                name={expanded ? "chevron.down" : "chevron.right"}
                size={folderTree.chevron}
                weight="semibold"
                color={selected ? folderTreeInk.selectedChevron : theme.textSecondary}
                style={CHEVRON}
              />
            ) : null}
          </Pressable>
          <Symbol name="folder" size={folderTree.folderIcon} color={selected ? theme.onAccent : theme.icon} style={FOLDER_ICON} />
          <Text lines={1} tone={selected ? "onAccent" : "textPrimary"} style={TITLE}>
            {row.title}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const CHEVRON = { width: folderTree.chevronBox, height: folderTree.chevronBox } as const;
const FOLDER_ICON = { width: folderTree.folderBox, height: folderTree.folderBox } as const;
const TITLE = { flex: 1, marginLeft: space.s } as const;
