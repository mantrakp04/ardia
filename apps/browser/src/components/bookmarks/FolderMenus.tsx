import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { useBookmarks } from "../../state/bookmarks/hooks";
import { useBarDrag, watchBookmarkEscape } from "../../state/bookmarks/barDrag";
import { closeFolderMenus, useFolderMenus, type FolderMenuPanel, type MenuRect } from "../../state/bookmarks/folderMenus";
import { useActiveTabId, useWindowId } from "../../state/browser/hooks";
import { OutsidePressArea, Panel, shadow, Text, useTheme } from "../ui";
import { ChipIcon } from "./BarItem";
import { useEased } from "./barMotion";
import { FolderMenu } from "./FolderMenu";
import { useBarSize } from "./barSize";
import { bookmarksBar } from "./tokens";

type Shown = { panel: FolderMenuPanel; closing: boolean };

const NO_PANELS: FolderMenuPanel[] = [];

export function FolderMenus() {
  const windowId = useWindowId();
  const panels = useFolderMenus(useShallow((s) => (s.windowId === windowId ? s.panels : NO_PANELS)));
  const root = useRef<View | null>(null);
  const [layer, setLayer] = useState<MenuRect>({ x: 0, y: 0, width: 0, height: 0 });
  const shown = usePresence(panels);
  const activeTab = useActiveTabId();
  const open = panels.length > 0;
  useEffect(() => {
    if (open) closeFolderMenus();
  }, [activeTab]);
  useEffect(() => watchBookmarkEscape(), []);

  return (
    <View
      ref={root}
      collapsable={false}
      pointerEvents="box-none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (open && (width !== layer.width || height !== layer.height)) closeFolderMenus();
        root.current?.measureInWindow((x, y) => setLayer({ x, y, width, height }));
      }}
    >
      {shown.length > 0 && (
        <OutsidePressArea pointerEvents="box-none" style={StyleSheet.absoluteFill} onOutsidePress={() => closeFolderMenus({ outside: true })}>
          {shown.map(({ panel, closing }) => (
            <FolderMenu key={`${panel.level}:${panel.key}`} windowId={windowId} panel={panel} layer={layer} closing={closing} onClosed={() => shown.remove(panel)} />
          ))}
        </OutsidePressArea>
      )}
      <DragGhost windowId={windowId} layer={layer} />
    </View>
  );
}

function usePresence(panels: FolderMenuPanel[]): Shown[] & { remove(panel: FolderMenuPanel): void } {
  const [closed, setClosed] = useState<FolderMenuPanel[]>([]);
  const last = useRef(panels);
  const live = new Set(panels.map(keyOf));
  const gone = last.current.filter((p) => !live.has(keyOf(p)) && !p.retained);
  last.current = panels;
  if (gone.length) setClosed((prev) => [...prev.filter((p) => !live.has(keyOf(p))), ...gone.filter((g) => !prev.some((p) => keyOf(p) === keyOf(g)))]);
  const list: Shown[] = [...closed.filter((p) => !live.has(keyOf(p))).map((panel) => ({ panel, closing: true })), ...panels.map((panel) => ({ panel, closing: false }))];
  list.sort((a, b) => a.panel.level - b.panel.level);
  return Object.assign(list, { remove: (panel: FolderMenuPanel) => setClosed((prev) => prev.filter((p) => keyOf(p) !== keyOf(panel))) });
}

const keyOf = (p: FolderMenuPanel) => `${p.level}:${p.key}`;

function DragGhost({ windowId, layer }: { windowId: string; layer: MenuRect }) {
  const theme = useTheme();
  const size = useBarSize();
  const drag = useBarDrag(useShallow((s) => (s.windowId === windowId && s.source?.kind === "bookmark" ? { id: s.source.id, x: s.x, y: s.y, grab: s.grab, edge: s.sidebarEdge } : null)));
  const node = useBookmarks((b) => (drag ? b.nodes[drag.id] : undefined));
  const shown = useEased(!!drag);
  if (!drag || !node) return null;
  const toSidebar = node.kind === "folder" && drag.x < drag.edge;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: drag.x - drag.grab.x - layer.x,
        top: drag.y - drag.grab.y - layer.y,
        width: drag.grab.width,
        height: drag.grab.height,
        opacity: Animated.multiply(shown, bookmarksBar.ghostOpacity),
      }}
    >
      <Panel fill={theme.panel} radius={size.radius} border={toSidebar ? theme.accent : theme.popoverBorder} borderWidth={toSidebar ? bookmarksBar.dropRing : undefined} shadow={shadow.popover} style={StyleSheet.absoluteFill}>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: size.titleGap, paddingHorizontal: size.padding }}>
          <ChipIcon size={size} favicon={node.kind === "url" ? node : undefined} icon={node.kind === "folder" ? "folder" : undefined} />
          <Text lines={1} size={size.text} style={GHOST_TITLE}>
            {node.title || (node.kind === "url" ? node.url : "")}
          </Text>
        </View>
      </Panel>
    </Animated.View>
  );
}

const GHOST_TITLE = { flexShrink: 1 } as const;
