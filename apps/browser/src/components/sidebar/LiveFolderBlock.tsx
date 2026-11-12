import { memo, useMemo } from "react";
import { Animated, Pressable, View } from "react-native";
import { errorText, manualRefresh, statusText } from "../../state/live/engine";
import { folderRows, type FolderRow } from "../../state/live/rows";
import { liveFolderIcon } from "../../state/live/sources";
import { updateFolder, useLive } from "../../state/live/store";
import type { LiveItem } from "../../state/live/types";
import { usePageProfileId, useTab } from "../../state/browser/hooks";
import { useLiveActiveTab, useLiveStrays } from "../../state/sidebar/hooks";
import { openSettings } from "../../state/settings/settingsWindows";
import { HoverSlot } from "../ui/HoverSlot";
import { Badge, Button, ContextMenuArea, Dot, ink, Symbol, useHover } from "../ui";
import { useTheme } from "../ui/theme";
import { useLiveColors } from "../live/tokens";
import { TabRow } from "./TabRow";
import { Fold, useFold, type FoldEntry } from "./Fold";
import { LIVE_FOLDER_PAD } from "./geometry";
import { useSidebarScale } from "./scale";
import { useDragFolded, useDragItem } from "./DragProvider";
import { dismissHover } from "../../state/sidebar/hover";
import { openLiveFolderMenu } from "../../state/sidebar/liveMenus";
import { registerRow } from "../../state/sidebar/sidebarUi";
import { TabIcon } from "./TabIcon";
import { useSidebarTokens } from "./tokens";
import { RefreshSpinner } from "./RefreshSpinner";
import { SidebarRowLabel, SidebarRowSurface } from "./SidebarRow";
import { MoreRow, NoteRow, SectionTitle, StackRow } from "./LiveFolderRows";
import { LiveItemRow } from "./LiveItemRow";
import { CompletedFooter, useCompletedShown } from "./CompletedFooter";
import { entryKey } from "../../state/sidebar/entryKey";

const UNREAD_DOT = 7;
const ALERT_GLYPH = 10;
const ALERT_BOX = 18;
const SPINNER_GLYPH = 10;
const SPINNER_BOX = 14;
const EMPTY: LiveItem[] = [];
const NONE: string[] = [];

export const LiveFolderBlock = memo(function LiveFolderBlock({ folderId, windowId }: { folderId: string; windowId: string }) {
  const tokens = useSidebarTokens();
  const m = useSidebarScale();
  const pad = m.px(LIVE_FOLDER_PAD);
  const folder = useLive((s) => s.folders[folderId]);
  const items = useLive((s) => s.items[folderId] ?? EMPTY);
  const showAll = useLive((s) => s.showAll);
  const folded = useDragFolded(entryKey("live", folderId));
  const collapsed = folded || !!folder?.collapsed;
  const rows = useMemo(() => (folder ? folderRows(folder, items, showAll) : []), [folder, items, showAll]);
  const itemIds = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const hiddenList = useLive((s) => s.hidden[folderId] ?? EMPTY);
  const repoHiddenList = useLive((s) => s.repoHidden[folderId] ?? EMPTY);
  const hiddenIds = useMemo(() => new Set([...hiddenList, ...repoHiddenList].map((i) => i.id)), [hiddenList, repoHiddenList]);
  const profileId = usePageProfileId();
  const strays = useLiveStrays(windowId, profileId, folderId, itemIds, hiddenIds);
  const activeTab = useLiveActiveTab(windowId, profileId, folderId, itemIds, hiddenIds);
  const activeItem = useTab(activeTab ?? undefined, (t) => t?.liveItem?.itemId ?? null);
  const completed = useCompletedShown(folderId).length > 0;
  const fold = useFold(collapsed);
  const foldedHeight = () => m.group.border * 2 + m.rowHeight + (activeTab ? m.rowHeight + pad : 0);
  const { wrapper, handle, headerRef } = useDragItem(entryKey("live", folderId), { kind: "live", tabIds: NONE, section: "pinnedGroups", liveFolderId: folderId, collapsed: !!folder?.collapsed, foldedHeight });
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
      <View style={{ borderRadius: m.group.radius, backgroundColor: tokens.groupFill, borderWidth: m.group.border, borderColor: tokens.groupStroke, paddingHorizontal: pad }}>
        <View ref={headerRef} {...handle} style={{ marginHorizontal: -pad }}>
          <FolderHeader folderId={folderId} windowId={windowId} collapsed={collapsed} />
        </View>
        <Fold fold={fold} collapsed={collapsed} entries={entries} keep={keep} padBottom={pad} />
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
  const m = useSidebarScale();
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
            <SidebarRowSurface
              fill={pressed ? theme.tabPressed : hovered ? tokens.groupHeaderHover : ink.clear}
              cornerRadius={m.group.innerRadius}
              padLeft={m.tabRow.contentLeft + m.px(LIVE_FOLDER_PAD)}
            >
              <TabIcon url={sourceSite} icon={icon} size={m.icon} />
              <SidebarRowLabel text={folder.name} weight="medium" color={tokens.groupTitle} />
              {status?.error ? (
                <Pressable onPress={() => openSettings("liveFolders")} tooltip={errorText(status.error.kind, status.error.source)} style={{ marginRight: m.space.xxs }}>
                  <Symbol name="exclamationmark.triangle.fill" size={m.px(ALERT_GLYPH)} color={colors.pending} style={{ width: m.px(ALERT_BOX), height: m.px(ALERT_BOX) }} />
                </Pressable>
              ) : null}
              <HoverSlot
                hovered={hovered && !updating}
                width={m.rowButton.box}
                hover={<RefreshButton spinning={false} tooltip={statusText(folderId)} onPress={() => void manualRefresh(folderId)} />}
              >
                {updating ? (
                  <RefreshButton spinning tooltip={statusText(folderId)} onPress={() => void manualRefresh(folderId)} />
                ) : collapsed ? (
                  <View style={{ flexDirection: "row", alignItems: "center", marginRight: m.space.xxs, gap: m.space.xs }}>
                    {unread ? <Dot size={m.px(UNREAD_DOT)} color={theme.accent} /> : null}
                    <Badge text={count} size="m" />
                  </View>
                ) : null}
              </HoverSlot>
            </SidebarRowSurface>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}

function RefreshButton({ spinning, tooltip, onPress }: { spinning: boolean; tooltip: string; onPress(): void }) {
  const theme = useTheme();
  const m = useSidebarScale();
  if (!spinning) return <Button variant="icon" icon="arrow.clockwise" box={m.rowButton.box} glyph={m.rowButton.glyph} weight="semibold" onPress={onPress} tooltip={tooltip} />;
  return (
    <View tooltip={tooltip} style={{ width: m.tabRow.closeSlot, height: m.tabRow.closeSlot, alignItems: "center", justifyContent: "center" }}>
      <RefreshSpinner>
        <Symbol name="arrow.clockwise" size={m.px(SPINNER_GLYPH)} weight="semibold" color={theme.textSecondary} style={{ width: m.px(SPINNER_BOX), height: m.px(SPINNER_BOX) }} />
      </RefreshSpinner>
    </View>
  );
}
