import { useContext } from "react";
import { Pressable, View } from "react-native";
import { usePageProfileId, useWindowId } from "../../state/browser/hooks";
import { statusText } from "../../state/live/engine";
import { liveFolderIcon } from "../../state/live/sources";
import { useLive } from "../../state/live/store";
import { dismissHover } from "../../state/sidebar/hover";
import { openLiveFolderMenu } from "../../state/sidebar/liveMenus";
import { registerRow } from "../../state/sidebar/sidebarUi";
import { openLiveStripMenu, useLiveFolderShown } from "../../state/tabs/stripLive";
import { useLiveColors } from "../live/tokens";
import { RefreshSpinner } from "../sidebar/RefreshSpinner";
import { TabIcon } from "../sidebar/TabIcon";
import { ContextMenuArea, Dot, Symbol, useHover } from "../ui";
import { GlassFill, useGlass } from "../ui/Glass";
import { useTheme } from "../ui/theme";
import { FloatingStrip } from "./context";
import { dockWidth } from "./stripGroups";
import { CHIP_HAIRLINE, DOCK_GAP, GAP, ITEM_HEIGHT, ITEM_TOP, PINNED_CELL, PINNED_FACE_INSET, PINNED_FACE_RADIUS, PINNED_SPACING, TAB_RADIUS } from "./tokens";

export function LiveFolderShelf({ folderIds }: { folderIds: string[] }) {
  const theme = useTheme();
  const glass = useGlass();
  return (
    <View style={{ marginTop: ITEM_TOP, marginRight: DOCK_GAP - GAP, width: dockWidth(folderIds.length), height: ITEM_HEIGHT, flexDirection: "row", alignItems: "center", gap: PINNED_SPACING }}>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          borderRadius: TAB_RADIUS,
          borderWidth: glass ? 0 : CHIP_HAIRLINE,
          borderColor: theme.pinnedRestingStroke,
          backgroundColor: glass ? undefined : theme.pinnedResting,
        }}
      >
        {glass ? <GlassFill radius={TAB_RADIUS} /> : null}
      </View>
      {folderIds.map((id) => (
        <LiveFolderCell key={id} folderId={id} />
      ))}
    </View>
  );
}

const FACE = { position: "absolute", left: PINNED_FACE_INSET, right: PINNED_FACE_INSET, top: PINNED_FACE_INSET, bottom: PINNED_FACE_INSET, borderRadius: PINNED_FACE_RADIUS } as const;
const CELL = { width: PINNED_CELL, height: ITEM_HEIGHT - 1, alignItems: "center", justifyContent: "center" } as const;
const UNREAD = { position: "absolute", top: 6, right: 6 } as const;
const WARNING = { position: "absolute", bottom: 4, right: 4, width: 10, height: 10 } as const;

function LiveFolderCell({ folderId }: { folderId: string }) {
  const theme = useTheme();
  const glass = useGlass();
  const colors = useLiveColors();
  const windowId = useWindowId();
  const profileId = usePageProfileId();
  const floating = useContext(FloatingStrip);
  const folder = useLive((s) => s.folders[folderId]);
  const unread = useLive((s) => (s.unread[folderId]?.length ?? 0) > 0);
  const updating = useLive((s) => s.status[folderId]?.state === "updating" || s.status[folderId]?.state === "initializing");
  const failing = useLive((s) => !!s.status[folderId]?.error);
  const shown = useLiveFolderShown(windowId, profileId, folderId);
  const { hovered, hoverProps } = useHover();
  if (!folder) return null;
  const { site, icon } = liveFolderIcon(folder);
  return (
    <View
      ref={floating ? undefined : (v) => registerRow(windowId, `livefolder|${folderId}`, v)}
      {...hoverProps}
      mouseDownCanMoveWindow={false}
      tooltip={`${folder.name}\n${statusText(folderId)}`}
    >
      <ContextMenuArea
        onContextMenu={() => {
          dismissHover();
          void openLiveFolderMenu(windowId, folderId);
        }}
      >
        <Pressable onPress={() => void openLiveStripMenu(windowId, folderId)} accessibilityLabel={folder.name}>
          {({ pressed }) => (
            <View style={CELL}>
              {glass && (shown || hovered || pressed) ? (
                <View style={FACE}>
                  <GlassFill radius={PINNED_FACE_RADIUS} state={pressed ? "pressed" : hovered ? "lit" : "active"} />
                </View>
              ) : (shown || hovered || pressed) && (
                <View style={[FACE, { backgroundColor: pressed ? theme.tabPressed : hovered ? theme.tabHover : theme.pinnedSelectedFill }]} />
              )}
              <View pointerEvents="none">
                {updating ? (
                  <RefreshSpinner>
                    <Symbol name="arrow.clockwise" size={12} weight="semibold" color={theme.textSecondary} style={{ width: 16, height: 16 }} />
                  </RefreshSpinner>
                ) : (
                  <TabIcon url={site} icon={icon} />
                )}
              </View>
              {unread ? <Dot size={5} color={theme.accent} style={UNREAD} /> : null}
              {failing ? <Symbol name="exclamationmark.triangle.fill" size={8} color={colors.pending} style={WARNING} /> : null}
            </View>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}
