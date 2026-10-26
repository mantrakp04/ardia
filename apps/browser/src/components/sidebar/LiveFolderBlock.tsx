import { memo, useEffect, useMemo, useRef } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { errorText, manualRefresh, statusText } from "../../state/live/engine";
import { folderRows, type FolderRow } from "../../state/live/rows";
import { liveFolderIcon } from "../../state/live/sources";
import { updateFolder, useLive } from "../../state/live/store";
import type { LiveItem } from "../../state/live/types";
import { usePageProfileId, useTab } from "../../state/browser/hooks";
import { useLiveActiveTab, useLiveStrays } from "../../state/sidebar/hooks";
import { openSettings } from "../../state/settings/settingsWindows";
import { HoverSlot } from "../ui/HoverSlot";
import { Button, ContextMenuArea, FadeLabel, font, ink, radius, Surface, Symbol, useHover, weight } from "../ui";
import { curve, duration } from "../ui/motion";
import { hex, layout, useTheme } from "../ui/theme";
import { useLiveColors } from "../live/tokens";
import { TabRow } from "./TabRow";
import { Fold, useFold, type FoldEntry } from "./Fold";
import { GROUP_BORDER, GROUP_HEADER_RADIUS, GROUP_PAD, GROUP_RADIUS } from "./geometry";
import { useDragFolded, useDragItem } from "./DragProvider";
import { dismissHover } from "../../state/sidebar/hover";
import { openLiveFolderMenu } from "../../state/sidebar/liveMenus";
import { registerRow } from "../../state/sidebar/sidebarUi";
import { TabIcon } from "./TabIcon";
import { TABULAR_NUMS, useSidebarTokens } from "./tokens";
import { MoreRow, NoteRow, SectionTitle, StackRow } from "./LiveFolderRows";
import { LiveItemRow } from "./LiveItemRow";
import { CompletedFooter, useCompletedShown } from "./CompletedFooter";

const PAD = GROUP_PAD;
const EMPTY: LiveItem[] = [];
const NONE: string[] = [];

export const LiveFolderBlock = memo(function LiveFolderBlock({ folderId, windowId }: { folderId: string; windowId: string }) {
  const tokens = useSidebarTokens();
  const folder = useLive((s) => s.folders[folderId]);
  const items = useLive((s) => s.items[folderId] ?? EMPTY);
  const showAll = useLive((s) => s.showAll);
  const folded = useDragFolded(`lf:${folderId}`);
  const collapsed = folded || !!folder?.collapsed;
  const rows = useMemo(() => (folder ? folderRows(folder, items, showAll) : []), [folder, items, showAll]);
  const itemIds = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const hiddenList = useLive((s) => s.hidden[folderId] ?? EMPTY);
  const hiddenIds = useMemo(() => new Set(hiddenList.map((i) => i.id)), [hiddenList]);
  const profileId = usePageProfileId();
  const strays = useLiveStrays(windowId, profileId, folderId, itemIds, hiddenIds);
  const activeTab = useLiveActiveTab(windowId, profileId, folderId, itemIds, hiddenIds);
  const activeItem = useTab(activeTab ?? undefined, (t) => t?.liveItem?.itemId ?? null);
  const completed = useCompletedShown(folderId).length > 0;
  const fold = useFold(collapsed);
  const foldedHeight = () => GROUP_BORDER * 2 + layout.rowHeight + (activeTab ? layout.rowHeight + PAD : 0);
  const { wrapper, handle, headerRef } = useDragItem(`lf:${folderId}`, { kind: "live", tabIds: NONE, section: "pinnedGroups", liveFolderId: folderId, collapsed: !!folder?.collapsed, foldedHeight });
  if (!folder) return null;

  const entries: FoldEntry[] = rows.length
    ? rows.map((row) => ({ key: row.key, node: <FolderRowView row={row} folderId={folderId} windowId={windowId} /> }))
    : [{ key: "note", node: <FolderNote folderId={folderId} /> }];
  for (const id of strays) entries.push({ key: `stray:${id}`, node: <TabRow tabId={id} /> });
  if (completed) entries.push({ key: "completed", node: <CompletedFooter folderId={folderId} windowId={windowId} /> });
  const keep = !activeTab
    ? null
    : strays.includes(activeTab)
      ? `stray:${activeTab}`
      : (rows.find((r) => (r.kind === "item" && r.item.id === activeItem) || (r.kind === "stack" && r.items.some((i) => i.id === activeItem)))?.key ?? null);

  return (
    <Animated.View ref={wrapper.ref} style={wrapper.style}>
      <View style={{ borderRadius: GROUP_RADIUS, backgroundColor: tokens.groupFill, borderWidth: GROUP_BORDER, borderColor: tokens.groupStroke, paddingHorizontal: PAD }}>
        <View ref={headerRef} {...handle} style={{ marginHorizontal: -PAD }}>
          <FolderHeader folderId={folderId} windowId={windowId} collapsed={collapsed} />
        </View>
        <Fold fold={fold} collapsed={collapsed} entries={entries} keep={keep} gap={layout.rowGap} padBottom={PAD} />
      </View>
    </Animated.View>
  );
});

function FolderRowView({ row, folderId, windowId }: { row: FolderRow; folderId: string; windowId: string }) {
  switch (row.kind) {
    case "header":
      return <SectionTitle title={row.title} />;
    case "more":
      return <MoreRow folderId={folderId} section={row.section} count={row.count} />;
    case "stack":
      return <StackRow folderId={folderId} windowId={windowId} stack={row} />;
    case "item":
      return <LiveItemRow folderId={folderId} item={row.item} windowId={windowId} />;
  }
}

function FolderNote({ folderId }: { folderId: string }) {
  const status = useLive((s) => s.status[folderId]);
  const kind = useLive((s) => s.folders[folderId]?.kind);
  const hidden = useLive((s) => s.hidden[folderId]?.length ?? 0);
  if (!status || status.state === "initializing" || (status.state === "updating" && !status.lastFetch)) return <NoteRow text="Loading…" spinner />;
  if (status.error) return <NoteRow text={errorText(status.error.kind, status.error.source)} onPress={() => openSettings("liveFolders")} icon="exclamationmark.triangle.fill" />;
  if (hidden) return <NoteRow text={`${hidden} hidden until you refresh`} onPress={() => void manualRefresh(folderId)} />;
  return <NoteRow text={kind === "pullRequests" ? "No open pull requests" : "No recent documents"} />;
}

function FolderHeader({ folderId, windowId, collapsed }: { folderId: string; windowId: string; collapsed: boolean }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const colors = useLiveColors();
  const folder = useLive((s) => s.folders[folderId]);
  const count = useLive((s) => s.items[folderId]?.length ?? 0);
  const unread = useLive((s) => (s.unread[folderId]?.length ?? 0) > 0);
  const status = useLive((s) => s.status[folderId]);
  const { hovered, hoverProps } = useHover();
  if (!folder) return null;
  const updating = status?.state === "updating" || status?.state === "initializing";
  const { site: sourceSite, icon } = liveFolderIcon(folder);

  return (
    <View ref={(v) => registerRow(windowId, `livefolder|${folderId}`, v)} {...hoverProps}>
      <ContextMenuArea
        onContextMenu={() => {
          dismissHover();
          void openLiveFolderMenu(windowId, folderId);
        }}
      >
        <Pressable
          onPress={() => {
            dismissHover();
            updateFolder(folderId, { collapsed: !collapsed });
          }}
        >
          {({ pressed }) => (
            <Surface
              fill={hex(pressed ? theme.tabPressed : hovered ? tokens.groupHeaderHover : ink.clear)}
              cornerRadius={GROUP_HEADER_RADIUS}
              style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: 9 + PAD, paddingRight: 6 }}
            >
              <TabIcon url={sourceSite} icon={icon} />
              <FadeLabel text={folder.name} fontSize={font.body.fontSize} weight="medium" color={tokens.groupTitle} style={{ flex: 1, height: 18, marginLeft: 5 }} />
              {status?.error ? (
                <Pressable onPress={() => openSettings("liveFolders")} tooltip={errorText(status.error.kind, status.error.source)} style={{ marginRight: 2 }}>
                  <Symbol name="exclamationmark.triangle.fill" size={10} color={colors.pending} style={{ width: 18, height: 18 }} />
                </Pressable>
              ) : null}
              <HoverSlot
                hovered={hovered && !updating}
                width={22}
                hover={<RefreshButton spinning={false} tooltip={statusText(folderId)} onPress={() => void manualRefresh(folderId)} />}
              >
                {updating ? (
                  <RefreshButton spinning tooltip={statusText(folderId)} onPress={() => void manualRefresh(folderId)} />
                ) : collapsed ? (
                  <View style={{ flexDirection: "row", alignItems: "center", marginRight: 2, gap: 5 }}>
                    {unread ? <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: theme.accent }} /> : null}
                    <View style={{ minWidth: 20, height: 18, borderRadius: 9, paddingHorizontal: 6, backgroundColor: tokens.countPill, alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ ...font.caption, fontWeight: weight.semibold, color: theme.textTab, fontVariant: TABULAR_NUMS }}>{count}</Text>
                    </View>
                  </View>
                ) : null}
              </HoverSlot>
            </Surface>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}

function RefreshButton({ spinning, tooltip, onPress }: { spinning: boolean; tooltip: string; onPress(): void }) {
  const theme = useTheme();
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!spinning) return;
    turn.setValue(0);
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: duration.spinnerTurn, easing: curve.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spinning]);
  if (!spinning) return <Button variant="icon" icon="arrow.clockwise" size={10} weight="semibold" box={22} radius={radius.m} onPress={onPress} tooltip={tooltip} />;
  return (
    <View tooltip={tooltip} style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{ transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] }}>
        <Symbol name="arrow.clockwise" size={10} weight="semibold" color={theme.textSecondary} style={{ width: 14, height: 14 }} />
      </Animated.View>
    </View>
  );
}
