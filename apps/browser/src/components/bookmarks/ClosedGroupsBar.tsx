import { useEffect, useState } from "react";
import { View, type LayoutRectangle } from "react-native";
import { useSettings, useWindow } from "../../state/browser/hooks";
import { openClosedGroupMenu, openClosedGroupsOverflowMenu } from "../../state/bookmarks/closedGroupMenus";
import { reopenClosedGroup } from "../../state/groups/closedGroups";
import { useClosedGroupsForProfile } from "../../state/groups/hooks";
import { GROUP_COLORS } from "../../state/groups/tokens";
import { ContextMenuArea, useTheme } from "../ui";
import { withAlpha } from "../ui/tokens";
import { sameRect } from "./barMotion";
import { BarButton } from "./BarItem";
import { useBarSize } from "./barSize";
import { bookmarksBar } from "./tokens";
import { barCandidates, barLayout } from "./barLayout";

type Props = { windowId: string; maxWidth: number; onWidth: (width: number) => void };

export function ClosedGroupsBar({ windowId, maxWidth, onWidth }: Props) {
  const profileId = useWindow(windowId, (window) => window?.kind === "main" ? window.profileId : "");
  const groups = useClosedGroupsForProfile(profileId);
  const shown = useSettings((s) => s.showClosedGroupsInBookmarksBar);
  const size = useBarSize();
  const theme = useTheme();
  const [frames, setFrames] = useState<Record<string, LayoutRectangle>>({});
  const candidates = barCandidates(groups, maxWidth, size.padding * 2 + bookmarksBar.closedGroupGap);
  const { width, overflowing, visible } = barLayout(
    candidates.map((entry) => entry.id), frames, maxWidth,
    bookmarksBar.overflowWidth, { gap: bookmarksBar.closedGroupGap, shrink: true, overflowing: candidates.length < groups.length },
  );
  const visibleIds = new Set(visible);
  const fits = (id: string) => visibleIds.has(id);
  const hidden = groups.filter((group) => !fits(group.id));
  useEffect(() => {
    onWidth(shown && groups.length ? width : 0);
  }, [shown, groups.length, width, onWidth]);
  if (!shown || !groups.length) return null;
  return (
    <View style={{ width, height: size.item, overflow: "hidden", flexShrink: 0 }}>
      <View style={{ width: candidates.length * (size.itemMaxWidth + bookmarksBar.closedGroupGap), flexDirection: "row", alignItems: "center" }}>
        {candidates.map((entry) => {
          const color = entry.group.color;
          const tint = color && color !== "none" ? (GROUP_COLORS[color]?.hex ?? theme.icon) : theme.icon;
          return (
            <ContextMenuArea
              key={entry.id}
              captureDescendants
              onContextMenu={() => void openClosedGroupMenu(windowId, entry.id)}
              onLayout={(e) => {
                const frame = e.nativeEvent.layout;
                setFrames((prev) => sameRect(prev[entry.id], frame) ? prev : { ...prev, [entry.id]: frame });
              }}
              pointerEvents={fits(entry.id) ? "auto" : "none"}
              style={{
                flexShrink: 0, opacity: fits(entry.id) ? 1 : 0,
                marginRight: bookmarksBar.closedGroupGap, borderRadius: size.radius,
                backgroundColor: color === "none" ? undefined : withAlpha(tint, bookmarksBar.closedGroupTint),
              }}
            >
              <BarButton
                title={entry.group.name || "Untitled group"}
                tooltip={`Reopen ${entry.group.name || "group"} (${entry.tabs.length} tabs)`}
                onPress={() => reopenClosedGroup(entry.id, windowId)}
              />
            </ContextMenuArea>
          );
        })}
      </View>
      {overflowing && (
        <View style={{ position: "absolute", top: 0, right: 0, width: bookmarksBar.overflowWidth, height: size.item }}>
          <BarButton
            icon="chevron.right.2" tooltip="More closed groups" width={bookmarksBar.overflowWidth}
            onPress={() => void openClosedGroupsOverflowMenu(windowId, hidden.map((entry) => entry.id))}
          />
        </View>
      )}
    </View>
  );
}
