import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { currentGroup } from "../../state/browser/current";
import { useGroup, usePageProfileId, useWindowId } from "../../state/browser/hooks";
import { updateGroup } from "../../state/groups/actions";
import { pressGroupClose, useGroupCloseControl } from "../../state/sidebar/closeControl";
import { openGroupMenu } from "../../state/sidebar/menus";
import { moveInGroup, tuckGroup, useHasTuckTarget } from "../../state/tabs/topStrip";
import { groupTint, useSidebarTokens } from "../sidebar/tokens";
import { Button, ContextMenuArea, useHover } from "../ui";
import { useTheme } from "../ui/theme";
import { font, weight, withAlpha } from "../ui/tokens";
import { GroupMember, StripGroupIcon } from "./GroupMember";
import { useOnto } from "./model";
import type { StripGroupEntry, StripMember } from "../../state/tabs/topStrip";
import { dragGeometry, dropIndex, GROUP_MARGIN_LEFT, GROUP_MARGIN_RIGHT, GROUP_SPRING, groupLayout, holds, MEMBERS_INSET, memberInteractive, TAIL_EXPANDED, tabsOf, type DragGeometry } from "./stripGroups";
import { OntoRing } from "./TabChip";
import { CHIP_HAIRLINE, GAP, GROUP_CHIP_PAD, GROUP_TITLE_GAP, GROUP_TITLE_MAX, ITEM_HEIGHT, ITEM_TOP, MID, STRIP_COLORS, TAB_RADIUS, TOP_STRIP_HEIGHT } from "./tokens";
import { useStripDrag } from "./useStripDrag";

export function StripGroup({
  entry,
  geometry,
  from,
  chip,
  activeId,
  chipWidth,
  onChipWidth,
  memberWidth,
  folderMeasured,
}: {
  entry: StripGroupEntry;
  geometry: DragGeometry;
  from: number;
  chip: number;
  activeId: string;
  chipWidth: number | undefined;
  onChipWidth: (width: number) => void;
  memberWidth: (m: StripMember) => number;
  folderMeasured: (groupId: string) => boolean;
}) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const windowId = useWindowId();
  const profileId = usePageProfileId();
  const group = useGroup(entry.id, (g) => g);
  const groupClose = useGroupCloseControl(entry.id);
  const onto = useOnto({ kind: "group", id: entry.id });
  const { hovered, hoverProps } = useHover();
  const expanded = !entry.collapsed;
  const widths = entry.members.map(memberWidth);
  const shown = entry.members.findIndex((m) => holds(m, activeId));
  const chipSize = chipWidth ?? 0;
  const { offsets, width } = groupLayout(chipSize, widths, GAP, expanded, shown);
  const members = useMemo(() => dragGeometry(entry.members.map((m, i) => ({ tabIds: tabsOf(m), width: widths[i]! })), GAP), [entry.members, widths.join()]);
  const tuckable = useHasTuckTarget(!expanded && shown >= 0, windowId, profileId, entry.id);
  const open = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  const size = useRef(new Animated.Value(width)).current;
  const state = `${expanded}:${shown >= 0 ? entry.members[shown]!.id : ""}`;
  const settled = useRef(state);
  const [moving, setMoving] = useState(false);
  const springs = useRef(0);
  useEffect(() => {
    const spring = (value: Animated.Value, toValue: number) => Animated.spring(value, { toValue, ...GROUP_SPRING, useNativeDriver: false });
    const run = (animation: Animated.CompositeAnimation) => {
      const id = ++springs.current;
      setMoving(true);
      animation.start(() => id === springs.current && setMoving(false));
    };
    if (settled.current !== state) {
      settled.current = state;
      run(Animated.parallel([spring(open, expanded ? 1 : 0), spring(size, width)]));
    } else if (moving) {
      run(spring(size, width));
    } else size.setValue(width);
  }, [state, width]);
  const fade = useMemo(() => open.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }), []);
  const drag = useStripDrag({
    tabId: null,
    ids: () => currentGroup(entry.id)?.tabIds ?? [],
    pinned: false,
    groupId: null,
    geometry,
    from,
    width: 0,
    gap: 0,
    axis: "x",
    local: true,
    drop: (dx) => {
      const to = dropIndex(geometry, from, dx);
      if (to === from) return true;
      const others = geometry.slots.filter((_, i) => i !== from);
      moveInGroup(entry.id, others[to]?.tabIds[0] ?? null);
      return true;
    },
  });
  const tail = useMemo(() => Animated.add(size, -(TAIL_EXPANDED - 2.25)), []);
  if (!group) return null;
  const tint = groupTint(group.color);
  const bare = group.color === "none";
  const divider = STRIP_COLORS[theme.dark ? "dark" : "light"].groupDivider;
  const tuck = () => tuckGroup(windowId, profileId, entry.id);
  return (
    <Animated.View
      ref={drag.ref}
      style={{ width: size, height: TOP_STRIP_HEIGHT, marginLeft: GROUP_MARGIN_LEFT, marginRight: GROUP_MARGIN_RIGHT, zIndex: drag.style.zIndex, transform: drag.style.transform, opacity: chipWidth === undefined ? 0 : 1 }}
    >
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          top: ITEM_TOP,
          width: size,
          height: ITEM_HEIGHT,
          borderRadius: TAB_RADIUS,
          borderWidth: CHIP_HAIRLINE,
          borderColor: bare ? "transparent" : theme.pinnedRestingStroke,
          backgroundColor: tint ? withAlpha(tint, hovered ? 0.24 : 0.18) : hovered ? tokens.groupHeaderHover : bare ? "transparent" : tokens.groupFill,
        }}
      />
      {onto && <OntoRing width={size} />}
      <Animated.View pointerEvents="none" style={{ position: "absolute", left: chipSize + 0.75, top: MID - 7.5, width: 0.5, height: 15, backgroundColor: divider, opacity: fade }} />
      {entry.members.map((m, i) => (
        <GroupMember
          key={m.id}
          member={m}
          width={widths[i]!}
          start={chipSize + MEMBERS_INSET}
          offset={offsets[i]!}
          open={open}
          interactive={memberInteractive(i === shown, expanded, moving)}
          shown={i === shown}
          geometry={members}
          from={expanded ? i : -1}
          chip={chip}
          activeId={activeId}
          measured={m.kind !== "folder" || folderMeasured(m.id)}
          tuck={tuckable && i === shown ? tuck : undefined}
          out={{ top: geometry, slot: from, chip: chipSize, expanded, left: (geometry.lefts[from] ?? 0) + chipSize + MEMBERS_INSET + (expanded ? offsets[i]! : 0) }}
        />
      ))}
      <Animated.View pointerEvents={expanded ? "box-none" : "none"} mouseDownCanMoveWindow={false} style={{ position: "absolute", top: ITEM_TOP, height: ITEM_HEIGHT, left: tail, flexDirection: "row", alignItems: "center", opacity: fade }}>
        <View style={{ width: 0.5, height: 15, backgroundColor: divider }} />
        {groupClose && <Button variant="icon" icon={groupClose.icon} size={9} weight="semibold" box={24} radius={6} style={{ marginLeft: 1 }} onPress={() => pressGroupClose(entry.id)} tooltip={groupClose.tooltip} />}
      </Animated.View>
      <View
        {...hoverProps}
        {...drag.panHandlers}
        mouseDownCanMoveWindow={false}
        tooltip={expanded ? "Collapse Group" : "Expand Group"}
        onLayout={(e) => onChipWidth(Math.ceil(e.nativeEvent.layout.width * 2) / 2)}
        style={{ position: "absolute", left: 0, top: ITEM_TOP, height: ITEM_HEIGHT }}
      >
        <ContextMenuArea onContextMenu={() => void openGroupMenu(windowId, entry.id)}>
          <Pressable
            onPress={() => updateGroup(entry.id, { collapsed: expanded })}
            style={{ height: ITEM_HEIGHT, flexDirection: "row", alignItems: "center", paddingLeft: GROUP_CHIP_PAD.left, paddingRight: GROUP_CHIP_PAD.right }}
          >
            <StripGroupIcon icon={group.icon} tint={tint} />
            <Text numberOfLines={1} style={{ marginLeft: GROUP_TITLE_GAP, maxWidth: GROUP_TITLE_MAX, fontSize: font.small.fontSize, fontWeight: weight.semibold, color: tint ?? (shown >= 0 ? theme.tabSelectedText : theme.textTab) }}>
              {group.name || `${group.tabIds.length} ${group.tabIds.length === 1 ? "Tab" : "Tabs"}`}
            </Text>
          </Pressable>
        </ContextMenuArea>
      </View>
    </Animated.View>
  );
}
