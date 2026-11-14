import { createContext, memo, useContext, useEffect, useState } from "react";
import { Animated, Pressable, View } from "react-native";
import { useTheme } from "../ui/theme";
import { useGroup, usePageProfileId, useWindowId } from "../../state/browser/hooks";
import { updateGroup } from "../../state/groups/actions";
import { noteGroupHeaderHide } from "../../state/telemetry/usage";
import { useGroupLabel } from "../../state/groups/hooks";
import { useSelectionInGroup } from "../../state/pins/hooks";
import { newCapture } from "../../state/sidebar/listCapture";
import { useCapturedGroupEntries, useGroupFirstTabIcon, useGroupTabIds, useKeptEntries, useShowsExtraTabs } from "../../state/sidebar/hooks";
import { MeetingTimeLabel, useMeetingCountdown } from "../live/MeetingCountdown";
import { HoverSlot } from "../ui/HoverSlot";
import { Button, ContextMenuArea, FadeLabel, ink, Symbol, Text, weight, withAlpha } from "../ui";
import { commitRename, endRename } from "../../state/sidebar/actions";
import { useDragFolded, useDragItem, useDropInto } from "./DragProvider";
import { useShift, type EntryMotion } from "./EntryMotion";
import { Fold, useFold } from "./Fold";
import { groupMembersPadBottom } from "./geometry";
import { useSidebarScale } from "./scale";
import { entryHeightNow, foldedGroupHeight, headGap } from "../../state/sidebar/geometry";
import { dismissHover } from "../../state/sidebar/hover";
import { useGroupHover, useRowHover } from "./hoverController";
import { HOVER_CARD_FADE_MS } from "./hoverMotion";
import { GhostSlot } from "./GhostEntry";
import { ListMotionContext, useGroupMotion } from "./ListMotion";
import { pressGroupClose, useGroupCloseControlWhile } from "../../state/sidebar/closeControl";
import { openGroupMenu } from "../../state/sidebar/menus";
import { registerRow, useSidebarUi } from "../../state/sidebar/sidebarUi";
import { TabIcon } from "./TabIcon";
import { RenameField, SplitRowItem, TabRowItem } from "./TabRow";
import { groupBoxAtRest, groupSurface, TABULAR_NUMS, useSidebarTokens } from "./tokens";
import { SidebarRowSurface } from "./SidebarRow";
import { curve } from "../ui/motion";
import { entryKey, parseEntry } from "../../state/sidebar/entryKey";
import { LiveFolderBlock } from "./LiveFolderBlock";
import { tailKey, type RowSection } from "./dragModel";
import { SharedFolderMark } from "./SharedFolderMark";

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
  const m = useSidebarScale();
  const stored = useGroup(groupId, (g) => !!g?.collapsed);
  const collapsed = useDragFolded(entryKey("group", groupId)) || stored;
  const color = useGroup(groupId, (g) => g?.color ?? null);
  const tabIds = useGroupTabIds(groupId);
  const [captured] = useState(newCapture);
  const entries = useCapturedGroupEntries(groupId, captured);
  const selectedInside = useSelectionInGroup(windowId, groupId);
  const profileId = usePageProfileId();
  const keptEntries = useKeptEntries(windowId, profileId, groupId);
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
  const boxOpacity = useBoxOpacity(nested.innermost || dropInto || groupBoxAtRest(color));

  const { fill, stroke } = groupSurface(color, tokens);

  return (
    <Animated.View ref={wrapper.ref} style={wrapper.style}>
      <View {...moved} {...box.hoverProps} ref={movedRef} style={[{ paddingVertical: m.group.border }, moved.style as object]}>
        <Animated.View
          pointerEvents="none"
          style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, borderRadius: m.group.radius, backgroundColor: fill, borderWidth: m.group.border, borderColor: stroke, opacity: boxOpacity }}
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
            keep={keptEntries}
            rowHeight={(key) => entryHeightNow(windowId, profileId, key)}
            padTop={headGap(collapsed && keptEntries.length ? keptEntries[0] : entries[0], m.rowGap)}
            padBottom={groupMembersPadBottom(collapsed ? keptEntries.length : entries.length, m.group.membersPadBottom)}
            indent={m.group.indent}
            indentEnd={m.group.inset}
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

const MEASURE_LABEL = { opacity: 0, fontVariant: TABULAR_NUMS } as const;
const CHEVRON_BOX = 10;
const CHEVRON_GLYPH = 9;

function GroupHeader({ groupId, windowId, collapsed, open }: { groupId: string; windowId: string; collapsed: boolean; open: Animated.Value }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const m = useSidebarScale();
  const group = useGroup(groupId, (g) => g);
  const label = useGroupLabel(groupId);
  const firstTab = useGroupFirstTabIcon(groupId);
  const renaming = useSidebarUi((u) => u.renaming?.kind === "group" && u.renaming.id === groupId);
  const dropInto = useDropInto() === groupId;
  const { hovered, hoverProps } = useRowHover(windowId, collapsed && !renaming ? { kind: "group", id: groupId } : null);
  const countdown = useMeetingCountdown(groupId);
  const closeControl = useGroupCloseControlWhile(groupId, hovered && !renaming);
  const profileId = usePageProfileId();
  const showsExtra = useShowsExtraTabs(windowId, profileId, groupId);
  if (!group) return null;
  const target = { kind: "group" as const, id: groupId };

  return (
    <View ref={(v) => registerRow(windowId, groupId, v)} {...hoverProps}>
      <ContextMenuArea
        onContextMenu={() => {
          dismissHover();
          void openGroupMenu(windowId, groupId);
        }}
      >
        <Pressable
          onPress={() => {
            dismissHover();
            if (renaming) return;
            if (!collapsed || !showsExtra) return updateGroup(groupId, { collapsed: !collapsed });
            noteGroupHeaderHide();
            updateGroup(groupId, { shownTabIds: [] });
          }}
        >
          {() => (
            <SidebarRowSurface fill={dropInto ? theme.tabPressed : ink.clear} cornerRadius={m.group.innerRadius}>
              {group.icon || firstTab ? (
                <TabIcon url={firstTab?.url ?? ""} favicon={firstTab?.favicon} icon={group.icon ?? firstTab?.customIcon} profileId={firstTab?.profileId} size={m.icon} />
              ) : (
                <View style={{ width: m.icon }} />
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
                <Animated.View style={{ flex: 1, height: m.tabRow.titleHeight, marginLeft: m.tabRow.titleGap, flexDirection: "row", alignItems: "center", transform: [{ rotate: countdown.rotate }] }}>
                  <View style={{ flexShrink: 1, height: m.tabRow.titleHeight, paddingRight: m.space.m, justifyContent: "center" }}>
                    <Text lines={1} weight="medium" style={[MEASURE_LABEL, { fontSize: m.font.body }]}>
                      {label}
                    </Text>
                    <FadeLabel text={label} fontSize={m.font.body} weight="medium" color={tokens.groupTitle} style={{ position: "absolute", left: 0, right: 0, top: 0, height: m.tabRow.titleHeight }} />
                  </View>
                  <SharedFolderMark groupId={groupId} />
                  <Animated.View
                    style={{
                      width: m.px(CHEVRON_BOX),
                      height: m.px(CHEVRON_BOX),
                      alignItems: "center",
                      justifyContent: "center",
                      transform: [{ rotate: open.interpolate({ inputRange: [0, 1], outputRange: ["-90deg", "0deg"] }) }],
                    }}
                  >
                    <Symbol name="chevron.down" size={m.px(CHEVRON_GLYPH)} weight="semibold" color={withAlpha(tokens.groupTitle, 0.5)} style={{ width: m.px(CHEVRON_BOX), height: m.px(CHEVRON_BOX) }} />
                  </Animated.View>
                </Animated.View>
              )}
              <HoverSlot
                hovered={hovered && !renaming}
                width={m.rowButton.box}
                hover={closeControl && <Button variant="icon" icon={closeControl.icon} box={m.rowButton.box} glyph={m.rowButton.glyph} weight="semibold" onPress={() => pressGroupClose(groupId)} tooltip={closeControl.tooltip} />}
              >
                {countdown.label && !renaming ? <MeetingTimeLabel label={countdown.label} urgent={countdown.urgent} fontSize={m.font.caption} gap={m.space.xs} /> : null}
              </HoverSlot>
            </SidebarRowSurface>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}
