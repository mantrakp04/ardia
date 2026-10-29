import { createContext, memo, useContext, useEffect, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { hex, layout, useTheme } from "../ui/theme";
import { useGroup, usePageProfileId, useWindowId } from "../../state/browser/hooks";
import { updateGroup } from "../../state/groups/actions";
import { useGroupLabel } from "../../state/groups/hooks";
import { useSelectionInGroup } from "../../state/pins/hooks";
import { newCapture } from "../../state/sidebar/listCapture";
import { useCapturedGroupEntries, useGroupFirstTabIcon, useGroupTabIds, useKeptEntry } from "../../state/sidebar/hooks";
import { MeetingTimeLabel, useMeetingCountdown } from "../live/MeetingCountdown";
import { HoverSlot } from "../ui/HoverSlot";
import { Button, ContextMenuArea, FadeLabel, font, ink, radius, Surface, Symbol, weight, withAlpha } from "../ui";
import { commitRename, endRename, startRename } from "../../state/sidebar/actions";
import { useDragFolded, useDragItem, useDropInto } from "./DragProvider";
import { useShift, type EntryMotion } from "./EntryMotion";
import { Fold, useFold } from "./Fold";
import { GROUP_BORDER, GROUP_HEADER_RADIUS, GROUP_INDENT, GROUP_PAD, GROUP_RADIUS } from "./geometry";
import { entryHeightNow, foldedGroupHeight, headGap } from "../../state/sidebar/geometry";
import { dismissHover } from "../../state/sidebar/hover";
import { useGroupHover, useRowHover } from "./hoverController";
import { HOVER_CARD_FADE_MS } from "./hoverMotion";
import { GhostSlot, ListMotionContext, useGroupMotion } from "./ListMotion";
import { pressGroupClose, useGroupCloseControlWhile } from "../../state/sidebar/closeControl";
import { openGroupMenu } from "../../state/sidebar/menus";
import { registerRow, useSidebarUi } from "../../state/sidebar/sidebarUi";
import { TabIcon } from "./TabIcon";
import { RenameField, SplitRowItem, TabRowItem } from "./TabRow";
import { groupSurface, TABULAR_NUMS, useSidebarTokens } from "./tokens";
import { curve } from "../ui/motion";
import { entryKey, parseEntry } from "../../state/sidebar/entryKey";
import { LiveFolderBlock } from "./LiveFolderBlock";
import { tailKey, type RowSection } from "./dragModel";

const PAD = GROUP_PAD;
const BOX_FADE = curve.fade;
const NO_GROUPS: ReadonlySet<string> = new Set();

type ReportInnerHover = (groupId: string, hovered: boolean) => void;
const InnerGroupHover = createContext<ReportInnerHover | null>(null);

function useInnermostHover(groupId: string, hovered: boolean) {
  const reportToParent = useContext(InnerGroupHover);
  const [hoveredInside, setHoveredInside] = useState(NO_GROUPS);
  const [reportInside] = useState(() => (id: string, on: boolean) =>
    setHoveredInside((was) => {
      if (was.has(id) === on) return was;
      const next = new Set(was);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    }),
  );
  useEffect(() => {
    if (!reportToParent || !hovered) return;
    reportToParent(groupId, true);
    return () => reportToParent(groupId, false);
  }, [reportToParent, hovered, groupId]);
  return { innermost: hovered && hoveredInside.size === 0, reportInside };
}

function useBoxOpacity(shown: boolean) {
  const [opacity] = useState(() => new Animated.Value(shown ? 1 : 0));
  useEffect(() => {
    const fade = Animated.timing(opacity, { toValue: shown ? 1 : 0, duration: HOVER_CARD_FADE_MS, easing: BOX_FADE, useNativeDriver: true });
    fade.start();
    return () => fade.stop();
  }, [shown]);
  return opacity;
}

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
  const stored = useGroup(groupId, (g) => !!g?.collapsed);
  const collapsed = useDragFolded(entryKey("group", groupId)) || stored;
  const color = useGroup(groupId, (g) => g?.color ?? null);
  const tabIds = useGroupTabIds(groupId);
  const [captured] = useState(newCapture);
  const entries = useCapturedGroupEntries(groupId, captured);
  const selectedInside = useSelectionInGroup(windowId, groupId);
  const profileId = usePageProfileId();
  const activeEntry = useKeptEntry(windowId, profileId, entries);
  const foldedHeight = () => foldedGroupHeight(windowId, profileId, groupId);
  const { wrapper, handle, headerRef } = useDragItem(entryKey("group", groupId), { kind: "group", tabIds, section, groupId, collapsed: stored, foldedHeight, parentGroup }, own?.clip);
  const tail = useDragItem(tailKey({ group: groupId }), { kind: "tail", tabIds: [], section, parentGroup: groupId });

  const fold = useFold(collapsed);
  const scope = useContext(ListMotionContext);
  const motion = useGroupMotion(windowId, profileId, groupId, entries, captured, section === "list" && !parentGroup ? scope : { enabled: scope.enabled, slideBelow: null }, scope.enabled && !collapsed);
  const [moved, movedRef] = useShift(own?.shift ?? null);
  const box = useGroupHover(windowId, groupId);
  const dropInto = useDropInto() === groupId;
  const nested = useInnermostHover(groupId, box.hovered);
  const boxOpacity = useBoxOpacity(nested.innermost || dropInto);

  const { fill, stroke } = groupSurface(color, tokens);

  return (
    <Animated.View ref={wrapper.ref} style={wrapper.style}>
      <View {...moved} {...box.hoverProps} ref={movedRef} style={[{ paddingVertical: GROUP_BORDER }, moved.style as object]}>
        <Animated.View
          pointerEvents="none"
          style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, borderRadius: GROUP_RADIUS, backgroundColor: fill, borderWidth: GROUP_BORDER, borderColor: stroke, opacity: boxOpacity }}
        />
        <View ref={headerRef} {...handle}>
          <GroupHeader groupId={groupId} windowId={windowId} collapsed={collapsed} open={fold.open} />
        </View>
        <InnerGroupHover.Provider value={nested.reportInside}>
          <Fold
            fold={fold}
            collapsed={collapsed}
            entries={motion.slots(entries).map((slot) =>
              "ghost" in slot
                ? { key: slot.ghost.key, ghost: true, node: <GhostSlot snapshot={slot.ghost.snapshot} top={slot.top} opacity={slot.ghost.opacity} /> }
                : {
                    key: slot.entry,
                    node: (
                      <SidebarEntry entry={slot.entry} section={section} parentGroup={groupId} motion={motion.motion(slot.entry)} />
                    ),
                  },
            )}
            keep={activeEntry}
            gap={layout.rowGap}
            rowHeight={(key) => entryHeightNow(windowId, profileId, key)}
            padTop={headGap(collapsed && activeEntry ? activeEntry : entries[0])}
            padBottom={PAD}
            indent={GROUP_INDENT}
            mountClosed={selectedInside}
            footer={<Animated.View ref={tail.wrapper.ref} style={tail.wrapper.style} />}
          />
        </InnerGroupHover.Provider>
        {motion.tail ? <Animated.View style={{ marginTop: motion.tail }} /> : null}
      </View>
    </Animated.View>
  );
});

export const SidebarEntry = memo(function SidebarEntry({
  entry,
  section,
  rowSection = section,
  parentGroup,
  motion = null,
}: {
  entry: string;
  section: "list" | "pinnedGroups";
  rowSection?: RowSection;
  parentGroup?: string;
  motion?: EntryMotion | null;
}) {
  const windowId = useWindowId();
  const { kind, id } = parseEntry(entry);
  if (kind === "live") return <LiveFolderBlock folderId={id} windowId={windowId} />;
  if (kind === "group") return <GroupBlock groupId={id} section={section} parentGroup={parentGroup} motion={motion} />;
  if (kind === "split") return <SplitRowItem splitId={id} section={rowSection} parentGroup={parentGroup} motion={motion} />;
  return <TabRowItem tabId={id} section={rowSection} parentGroup={parentGroup} motion={motion} />;
});

function GroupHeader({ groupId, windowId, collapsed, open }: { groupId: string; windowId: string; collapsed: boolean; open: Animated.Value }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const group = useGroup(groupId, (g) => g);
  const label = useGroupLabel(groupId);
  const firstTab = useGroupFirstTabIcon(groupId);
  const renaming = useSidebarUi((u) => u.renaming?.kind === "group" && u.renaming.id === groupId);
  const dropInto = useDropInto() === groupId;
  const { hovered, hoverProps } = useRowHover(windowId, collapsed && !renaming ? { kind: "group", id: groupId } : null);
  const countdown = useMeetingCountdown(groupId);
  const closeControl = useGroupCloseControlWhile(groupId, hovered && !renaming);
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
            if (!renaming) updateGroup(groupId, { collapsed: !collapsed });
          }}
        >
          {({ pressed }) => (
            <Surface
              fill={hex(dropInto || pressed ? theme.tabPressed : hovered ? tokens.groupHeaderHover : ink.clear)}
              cornerRadius={GROUP_HEADER_RADIUS}
              style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: 9, paddingRight: 6 }}
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
                  weight={weight.medium}
                  onDone={(text) => (text === null ? endRename(target) : commitRename(target, text))}
                />
              ) : (
                <Animated.View style={{ flex: 1, height: 18, marginLeft: 5, flexDirection: "row", alignItems: "center", transform: [{ rotate: countdown.rotate }] }}>
                  <View style={{ flexShrink: 1, height: 18, paddingRight: 8, justifyContent: "center" }}>
                    <Text numberOfLines={1} style={{ opacity: 0, ...font.body, fontWeight: weight.medium, fontVariant: TABULAR_NUMS }}>
                      {label}
                    </Text>
                    <FadeLabel text={label} fontSize={font.body.fontSize} weight="medium" color={tokens.groupTitle} style={{ position: "absolute", left: 0, right: 0, top: 0, height: 18 }} />
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
                hover={closeControl && <Button variant="icon" icon={closeControl.icon} size={10} weight="semibold" box={22} radius={radius.m} onPress={() => pressGroupClose(groupId)} tooltip={closeControl.tooltip} />}
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
