import { memo, useContext, useEffect, useMemo, useRef } from "react";
import { Animated, ScrollView } from "react-native";
import { PageProfileContext, useWindowId } from "../../state/browser/hooks";
import { tabDragging } from "../../state/drag/tabDrag";
import { useShownTabIdFor, useStripEntries } from "../../state/tabs/topStrip";
import { setMeasuredWidth, useMeasuredWidths } from "../../state/windows/measuredWidths";
import { usePageStyle } from "../../state/windows/profilePager";
import { ThemeScope } from "../window/ThemeScope";
import { DockContext, FloatingStrip } from "./context";
import { IncomingGap, useIncomingTab } from "./IncomingTab";
import { chipKey, dockWidth, folderKey, holds, parseEntries, tabsOf, units, type DropTarget, type GroupEntry, type Member, type Strip } from "./model";
import { NewTabButton } from "./NewTabButton";
import { PinnedDock } from "./PinnedDock";
import { SplitChip } from "./SplitChip";
import { dockCellOf, dragGeometry, GROUP_MARGIN_LEFT, GROUP_MARGIN_RIGHT, groupLayout, MEMBERS_INSET, revealOffset, stripTabWidth, type DragSlot } from "./stripGroups";
import { StripGroup } from "./StripGroup";
import { DraggableChip } from "./TabChip";
import { DOCK_GAP, FLARE, GAP, ITEM_HEIGHT, MAX_CHIP, MIN_CHIP, PINNED_CELL, PINNED_SPACING } from "./tokens";

export const StripPage = memo(function StripPage({ profileId, slot, pageWidth, current, resting }: { profileId: string; slot: number; pageWidth: number; current: boolean; resting: boolean }) {
  const windowId = useWindowId();
  const flare = useContext(FloatingStrip) ? 0 : FLARE;
  const pageStyle = usePageStyle(windowId, slot, pageWidth + flare * 2);
  const entries = useStripEntries(windowId, profileId);
  const activeId = useShownTabIdFor(windowId, profileId);
  const parsed = useMemo(() => parseEntries(entries), [entries]);
  const groupIds = parsed.flatMap((e) => (e.kind === "group" ? [e.id] : []));
  const chipWidths = useMeasuredWidths(groupIds.map(chipKey));
  const chipOf = (groupId: string) => chipWidths[groupIds.indexOf(groupId)];
  const visible = parsed.flatMap((e): Member[] => (e.kind === "group" ? (e.collapsed ? e.members.filter((m) => holds(m, activeId)) : e.members) : e.kind === "dock" ? [] : [e]));
  const folderIds = parsed.flatMap((e) => (e.kind === "group" ? e.members.flatMap((m) => (m.kind === "folder" ? [m.id] : [])) : []));
  const folderWidths = useMeasuredWidths(folderIds.map(folderKey));
  const folderChip = (groupId: string) => folderWidths[folderIds.indexOf(groupId)];
  const pinnedCount = parsed.reduce((n, e) => n + (e.kind === "dock" ? e.ids.length : 0), 0);
  const chip = stripTabWidth({
    pageWidth,
    dockWidth: pinnedCount ? pinnedCount * (PINNED_CELL + PINNED_SPACING) - PINNED_SPACING + DOCK_GAP : 0,
    groups: parsed.flatMap((e) => (e.kind === "group" ? [{ chip: chipOf(e.id) ?? 0, expanded: !e.collapsed, shown: e.members.some((m) => holds(m, activeId)) }] : [])),
    tabUnits: visible.reduce((n, m) => n + units(m, activeId), 0),
    fixed: visible.reduce((n, m) => n + (m.kind === "folder" ? (folderChip(m.id) ?? 0) + (holds(m, activeId) ? MEMBERS_INSET : GAP) : 0), 0),
    gap: GAP,
    plus: ITEM_HEIGHT,
    min: MIN_CHIP,
    max: MAX_CHIP,
  });
  const memberWidth = (m: Member) => (m.kind === "folder" ? (folderChip(m.id) ?? 0) + (holds(m, activeId) ? MEMBERS_INSET + chip : 0) : chip * units(m, activeId));
  const top = dragGeometry(
    parsed.flatMap((e): DragSlot[] => {
      if (e.kind === "dock") return [];
      if (e.kind !== "group") return [{ tabIds: tabsOf(e), width: chip * units(e, activeId) }];
      const widths = e.members.map(memberWidth);
      const shown = e.members.findIndex((m) => holds(m, activeId));
      const width = groupLayout(chipOf(e.id) ?? 0, widths, GAP, !e.collapsed, shown).width;
      return [{ tabIds: e.members.flatMap(tabsOf), width, marginLeft: GROUP_MARGIN_LEFT, marginRight: GROUP_MARGIN_RIGHT }];
    }),
    GAP,
  );
  const targets = parsed.flatMap((e): (DropTarget | null)[] => (e.kind === "dock" ? [] : e.kind === "group" || e.kind === "tab" ? [{ kind: e.kind, id: e.id }] : [null]));
  const slotOf = (id: string) => top.slots.findIndex((slot) => slot.tabIds[0] === id);
  const dockIds = parsed.flatMap((e) => (e.kind === "dock" ? e.ids : []));
  const dockTabs = (cell: string) => parsed.find((e) => e.kind === "dock")?.members.get(cell) ?? [cell];
  const grow = useRef(new Animated.Value(0)).current;
  const dockGeometry = useMemo(() => dragGeometry(dockIds.map((id) => ({ tabIds: dockTabs(id), width: PINNED_CELL })), PINNED_SPACING), [entries.filter((e) => e.startsWith("pinned:") || e.startsWith("tilefolder:")).join()]);
  const strip: Strip = { top, targets, chip, grow, dock: dockIds.length ? { ids: dockIds, left: -(dockWidth(dockIds.length) + DOCK_GAP), geometry: dockGeometry } : null };
  const incoming = useIncomingTab(windowId, current, top);
  const scroll = useRef<ScrollView>(null);
  const scrolled = useRef(0);
  const spanOf = (tabId: string): [number, number] | null => {
    const cell = dockCellOf(dockIds, dockTabs, tabId);
    if (cell >= 0) return [flare + (dockGeometry.lefts[cell] ?? 0), PINNED_CELL];
    const i = top.slots.findIndex((slot) => slot.tabIds.includes(tabId));
    if (i < 0) return null;
    const left = flare + (dockIds.length ? dockWidth(dockIds.length) + DOCK_GAP : 0) + top.lefts[i]!;
    const group = parsed.find((e): e is GroupEntry => e.kind === "group" && e.members.some((m) => holds(m, tabId)));
    if (!group) return [left, top.slots[i]!.width];
    const at = group.members.findIndex((m) => holds(m, tabId));
    const widths = group.members.map(memberWidth);
    const { offsets } = groupLayout(chipOf(group.id) ?? 0, widths, GAP, !group.collapsed, at);
    return [left + (chipOf(group.id) ?? 0) + MEMBERS_INSET + (group.collapsed ? 0 : offsets[at]!), widths[at]!];
  };
  const latestSpan = useRef(spanOf);
  latestSpan.current = spanOf;
  const revealed = useRef(activeId);
  useEffect(() => {
    if (revealed.current === activeId) return;
    revealed.current = activeId;
    if (!current || !activeId || tabDragging()) return;
    const frame = requestAnimationFrame(() => {
      const span = latestSpan.current(activeId);
      const x = span && revealOffset(span[0], span[1], scrolled.current, pageWidth + flare * 2, flare + GAP);
      if (x !== null) scroll.current?.scrollTo({ x, animated: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeId, current]);
  let slotIndex = 0;
  const gap = (i: number) => (incoming.active ? <IncomingGap key={`gap${i}`} open={incoming.at === i} width={chip} origin={i === 0 ? incoming.origin : undefined} /> : null);

  return (
    <Animated.View
      pointerEvents={current ? "auto" : "none"}
      style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pageWidth + flare * 2, display: resting ? "none" : "flex", ...pageStyle }}
    >
      <PageProfileContext.Provider value={profileId}>
        <ThemeScope>
          <DockContext.Provider value={strip}>
            <ScrollView
              ref={scroll}
              horizontal
              showsHorizontalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={(e) => void (scrolled.current = e.nativeEvent.contentOffset.x)}
              style={{ flex: 1 }}
              contentContainerStyle={{ alignItems: "flex-start", gap: GAP, paddingLeft: flare, paddingRight: flare }}
            >
              {parsed.flatMap((e) => {
                if (e.kind === "dock") return <PinnedDock key="dock" tabIds={e.ids} />;
                const before = gap(slotIndex++);
                if (e.kind === "group")
                  return [
                    before,
                    <StripGroup
                      key={e.id}
                      entry={e}
                      geometry={top}
                      from={slotOf(e.members[0] ? tabsOf(e.members[0])[0]! : "")}
                      chip={chip}
                      activeId={activeId}
                      chipWidth={chipOf(e.id)}
                      onChipWidth={(width) => setMeasuredWidth(chipKey(e.id), width)}
                      memberWidth={memberWidth}
                      folderMeasured={(groupId) => folderChip(groupId) !== undefined}
                    />,
                  ];
                if (e.kind === "split")
                  return [before, <SplitChip key={e.id} tabIds={e.tabIds} width={chip * Math.min(e.tabIds.length, 2)} geometry={top} from={slotOf(e.tabIds[0]!)} group={null} />];
                return [before, <DraggableChip key={e.id} tabId={e.id} width={chip} geometry={top} from={slotOf(e.id)} group={null} />];
              })}
              {gap(top.slots.length)}
              <NewTabButton windowId={windowId} geometry={top} />
            </ScrollView>
          </DockContext.Provider>
        </ThemeScope>
      </PageProfileContext.Provider>
    </Animated.View>
  );
});
