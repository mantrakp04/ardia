import { ContextMenuArea, FadeLabel, Surface, Symbol } from "@ardia/shell";
import { memo, useContext, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { hex, layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { usePageProfileId, useWindowId } from "../../store/hooks";
import { groupLabel } from "../../store/organize";
import { MeetingTimeLabel, useMeetingCountdown } from "../live/MeetingCountdown";
import { HoverSlot } from "../HoverSlot";
import { IconButton } from "../primitives";
import { commitRename, endRename, startRename } from "./actions";
import { useDragFolded, useDragItem, useDropInto } from "./dnd";
import { useShift, type EntryMotion } from "./entryMotion";
import { Fold, useFold } from "./Fold";
import { entryHeight, GROUP_BORDER, GROUP_HEADER_RADIUS, GROUP_INDENT, GROUP_PAD, GROUP_RADIUS, keptEntry } from "./geometry";
import { groupEntries } from "./entries";
import { dismissHover, useRowHover } from "./hover";
import { capture, GhostSlot, ListMotionContext, newCapture, useGroupMotion } from "./listMotion";
import { pressGroupClose, useGroupCloseControl } from "./closeControl";
import { openGroupMenu } from "./menus";
import { registerRow, useSidebarUi } from "./state";
import { TabIcon } from "./TabIcon";
import { RenameField, SplitRowItem, TabRowItem } from "./TabRow";
import { GROUP_COLORS, useSidebarTokens, withAlpha } from "./tokens";

const PAD = GROUP_PAD;

export const GroupBlock = memo(function GroupBlock({
  groupId,
  section,
  parentGroup,
  motion: own = null,
}: {
  groupId: string;
  section: "list" | "pinnedGroups";
  parentGroup?: string;
  motion?: EntryMotion | null;
}) {
  const windowId = useWindowId();
  const tokens = useSidebarTokens();
  const stored = useBrowser((s) => !!s.groups[groupId]?.collapsed);
  const collapsed = useDragFolded(`g:${groupId}`) || stored;
  const color = useBrowser((s) => s.groups[groupId]?.color ?? null);
  const tabIds = useBrowser((s) => s.groups[groupId]?.tabIds.join(",") ?? "");
  const [captured] = useState(newCapture);
  const entries = useBrowser(
    useShallow((s) => {
      const list = groupEntries(s, groupId);
      return capture(captured, s, list, list);
    }),
  );
  const selectedInside = useBrowser((s) => {
    const selection = s.selection[windowId];
    return !!selection?.length && !!s.groups[groupId]?.tabIds.some((id) => selection.includes(id));
  });
  const profileId = usePageProfileId();
  const activeEntry = useBrowser((s) => keptEntry(s, windowId, profileId, entries));
  const foldedHeight = () => {
    const s = useBrowser.getState();
    const kept = keptEntry(s, windowId, profileId, groupEntries(s, groupId));
    return GROUP_BORDER * 2 + layout.rowHeight + (kept ? entryHeight(s, windowId, profileId, kept) + PAD : 0);
  };
  const { wrapper, handle, headerRef } = useDragItem(`g:${groupId}`, { kind: "group", tabIds: tabIds.split(",").filter(Boolean), section, groupId, collapsed: stored, foldedHeight, parentGroup }, undefined, own?.clip);
  const tail = useDragItem(`tail:group:${groupId}`, { kind: "tail", tabIds: [], section, parentGroup: groupId });

  const fold = useFold(collapsed);
  const scope = useContext(ListMotionContext);
  const motion = useGroupMotion(windowId, profileId, groupId, entries, captured, section === "list" && !parentGroup ? scope : { enabled: scope.enabled, slideBelow: null }, scope.enabled && !collapsed);
  const [moved, movedRef] = useShift(own?.shift ?? null);

  const spec = color ? GROUP_COLORS[color] : null;
  const fill = spec ? withAlpha(spec.hex, 0.16) : tokens.groupFill;
  const stroke = spec ? withAlpha(spec.hex, 0.3) : tokens.groupStroke;

  return (
    <Animated.View ref={wrapper.ref} style={wrapper.style}>
      <View {...moved} ref={movedRef} style={[{ borderRadius: GROUP_RADIUS, backgroundColor: fill, borderWidth: GROUP_BORDER, borderColor: stroke, paddingHorizontal: PAD }, moved.style as object]}>
        <View ref={headerRef} {...handle} style={{ marginHorizontal: -PAD }}>
          <GroupHeader groupId={groupId} windowId={windowId} collapsed={collapsed} open={fold.open} />
        </View>
        <Fold
          fold={fold}
          collapsed={collapsed}
          entries={motion.slots(entries).map((slot) =>
            "ghost" in slot
              ? { key: slot.ghost.key, ghost: true, node: <GhostSlot snapshot={slot.ghost.snapshot} top={slot.top} opacity={slot.ghost.opacity} /> }
              : {
                  key: slot.entry,
                  node: (
                    <Entry entry={slot.entry} section={section} groupId={groupId} motion={motion.motion(slot.entry)} />
                  ),
                },
          )}
          keep={activeEntry}
          gap={layout.rowGap}
          rowHeight={(key) => entryHeight(useBrowser.getState(), windowId, profileId, key)}
          padBottom={PAD}
          indent={GROUP_INDENT}
          mountClosed={selectedInside}
          footer={<Animated.View ref={tail.wrapper.ref} style={tail.wrapper.style} />}
        />
        {motion.tail ? <Animated.View style={{ marginTop: motion.tail }} /> : null}
      </View>
    </Animated.View>
  );
});

const Entry = memo(function Entry({ entry, section, groupId, motion }: { entry: string; section: "list" | "pinnedGroups"; groupId: string; motion: EntryMotion | null }) {
  if (entry.startsWith("g:")) return <GroupBlock groupId={entry.slice(2)} section={section} parentGroup={groupId} motion={motion} />;
  return entry.startsWith("s:") ? (
    <SplitRowItem splitId={entry.slice(2)} section={section} parentGroup={groupId} motion={motion} />
  ) : (
    <TabRowItem tabId={entry.slice(2)} section={section} parentGroup={groupId} motion={motion} />
  );
});

function GroupHeader({ groupId, windowId, collapsed, open }: { groupId: string; windowId: string; collapsed: boolean; open: Animated.Value }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const group = useBrowser((s) => s.groups[groupId]);
  const label = useBrowser((s) => (s.groups[groupId] ? groupLabel(s, s.groups[groupId]!) : ""));
  const firstTab = useBrowser(
    useShallow((s) => {
      const t = s.tabs[s.groups[groupId]?.tabIds[0] ?? ""];
      return t && { url: t.url, favicon: t.favicon, customIcon: t.customIcon, profileId: t.profileId };
    }),
  );
  const renaming = useSidebarUi((u) => u.renaming?.kind === "group" && u.renaming.id === groupId);
  const dropInto = useDropInto() === groupId;
  const { hovered, hoverProps } = useRowHover(windowId, collapsed && !renaming ? { kind: "group", id: groupId } : null);
  const countdown = useMeetingCountdown(groupId);
  const closeControl = useGroupCloseControl(groupId);
  if (!group) return null;
  const target = { kind: "group" as const, id: groupId };

  return (
    <View ref={(v) => registerRow(windowId, groupId, v)} {...hoverProps} onDoubleClick={() => void startRename(windowId, target)}>
      <ContextMenuArea
        onContextMenu={() => {
          dismissHover();
          void openGroupMenu(windowId, groupId);
        }}
      >
        <Pressable
          onPress={() => {
            dismissHover();
            if (!renaming) useBrowser.getState().updateGroup(groupId, { collapsed: !collapsed });
          }}
        >
          {({ pressed }) => (
            <Surface
              fill={hex(dropInto || pressed ? theme.tabPressed : hovered ? tokens.groupHeaderHover : "rgba(0,0,0,0)")}
              cornerRadius={GROUP_HEADER_RADIUS}
              style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: 9 + PAD, paddingRight: 6 }}
            >
              {group.icon || firstTab ? (
                <TabIcon url={firstTab?.url ?? ""} favicon={firstTab?.favicon} icon={group.icon ?? firstTab?.customIcon} profileId={firstTab?.profileId} />
              ) : (
                <View style={{ width: 16 }} />
              )}
              {renaming ? (
                <RenameField
                  initial={group.name}
                  placeholder={label}
                  color={tokens.groupTitle}
                  weight="500"
                  onDone={(text) => (text === null ? endRename(target) : commitRename(target, text))}
                />
              ) : (
                <Animated.View style={{ flex: 1, height: 18, marginLeft: 5, flexDirection: "row", alignItems: "center", transform: [{ rotate: countdown.rotate }] }}>
                  <View style={{ flexShrink: 1, height: 18, paddingRight: 8, justifyContent: "center" }}>
                    <Text numberOfLines={1} style={{ opacity: 0, fontSize: 13, fontWeight: "500", fontVariant: ["tabular-nums"] }}>
                      {label}
                    </Text>
                    <FadeLabel text={label} fontSize={13} weight="medium" color={tokens.groupTitle} style={{ position: "absolute", left: 0, right: 0, top: 0, height: 18 }} />
                  </View>
                  <Animated.View
                    style={{
                      width: 10,
                      height: 10,
                      marginLeft: 0,
                      alignItems: "center",
                      justifyContent: "center",
                      transform: [{ rotate: open.interpolate({ inputRange: [0, 1], outputRange: ["-90deg", "0deg"] }) }],
                    }}
                  >
                    <Symbol name="chevron.down" size={9} weight="semibold" color={withAlpha(tokens.groupTitle, 0.5)} style={{ width: 10, height: 10 }} />
                  </Animated.View>
                </Animated.View>
              )}
              <HoverSlot
                hovered={hovered && !renaming}
                width={22}
                hover={closeControl && <IconButton icon={closeControl.icon} size={10} weight="semibold" box={22} radius={6} onPress={() => pressGroupClose(groupId)} tooltip={closeControl.tooltip} />}
              >
                {countdown.label && !renaming ? <MeetingTimeLabel label={countdown.label} urgent={countdown.urgent} /> : null}
              </HoverSlot>
            </Surface>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}
