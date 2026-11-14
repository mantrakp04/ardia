import { Animated } from "react-native";
import { Badge, FadeLabel, Panel } from "../ui";
import { useTheme } from "../ui/theme";
import { liveFolderIcon } from "../../state/live/sources";
import { useLive } from "../../state/live/store";
import { useGroup, useTab } from "../../state/browser/hooks";
import { useDragGhostLabel } from "../../state/sidebar/hooks";
import { useTabDrag } from "../../state/drag/tabDrag";
import type { Ghost } from "./dragModel";
import { FolderMosaic } from "./FolderTile";
import { TabIcon } from "./TabIcon";
import { SIDEBAR_SHADOW, useSidebarTokens } from "./tokens";
import { useSidebarScale } from "./scale";
import { folderOf } from "./dragModel";

export function DragGhost({ ghost }: { ghost: Ghost }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const m = useSidebarScale();
  const { item, count, width, height, position } = ghost;
  const tab = useTab(item.tabIds[0] ?? "");
  const liveFolderId = item.kind === "live" ? item.liveFolderId : undefined;
  const groupId = item.kind === "group" ? item.groupId : undefined;
  const folder = useLive((s) => (liveFolderId ? s.folders[liveFolderId] : undefined));
  const liveIcon = folder ? liveFolderIcon(folder) : null;
  const groupIcon = useGroup(groupId ?? null, (g) => g?.icon ?? null);
  const label = useDragGhostLabel(folder?.name, groupId, tab);
  const tile = item.kind === "tile";
  const folderTile = !!folderOf(item);
  const onPage = useTabDrag((d) => d.phase === "tab" && d.onPage);
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width, height, opacity: onPage ? 0 : 1, transform: position.getTranslateTransform() }}>
      <Panel
        fill={tokens.dragSilhouette}
        radius={m.radius.chrome}
        border={tokens.dragBorder}
        shadow={SIDEBAR_SHADOW.dragGhost}
        style={{
          width,
          height: tile ? m.tile.height : height,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: tile ? "center" : "flex-start",
          paddingLeft: tile ? 0 : m.tabRow.contentLeft,
          paddingRight: m.tabRow.trailing,
          opacity: 0.96,
        }}
      >
        {liveIcon ? <TabIcon url={liveIcon.site} icon={liveIcon.icon} size={m.icon} /> : null}
        {folderTile ? <FolderMosaic tabIds={item.tabIds} /> : null}
        {!folderTile && (groupIcon || tab) ? <TabIcon url={tab?.url ?? ""} favicon={tab?.favicon} icon={groupIcon ?? tab?.customIcon} profileId={tab?.profileId} size={m.icon} /> : null}
        {!tile ? (
          <FadeLabel
            text={label}
            fontSize={m.font.body}
            weight={item.kind === "group" || item.kind === "live" ? "medium" : "regular"}
            color={theme.textPrimary}
            style={{ flex: 1, height: m.tabRow.titleHeight, marginLeft: m.space.m }}
          />
        ) : null}
      </Panel>
      {count > 1 && !folderTile ? (
        <Badge text={count} tone="accent" size="m" scale={m.scale} style={COUNT_BADGE} />
      ) : null}
    </Animated.View>
  );
}

const COUNT_BADGE = { position: "absolute", top: -6, right: -4 } as const;
