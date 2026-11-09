import { memo, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Animated, ScrollView, View } from "react-native";
import { PageProfileContext, useWindowId } from "../../state/browser/hooks";
import { tabDragging } from "../../state/drag/tabDrag";
import { useShownTabIdFor, useStripEntries } from "../../state/tabs/topStrip";
import { setMeasuredWidth, useMeasuredWidths } from "../../state/windows/measuredWidths";
import { dismissStripHoverIn } from "../../state/tabs/stripHover";
import { usePageStyle } from "../../state/windows/profilePager";
import { ThemeScope } from "../window/ThemeScope";
import { DockContext, FloatingStrip } from "./context";
import { IncomingGap, useIncomingTab } from "./IncomingTab";
import { chipKey, folderKey, type Strip } from "./model";
import { NewTabButton } from "./NewTabButton";
import { PinnedDock } from "./PinnedDock";
import { SplitChip } from "./SplitChip";
import { layoutDock, layoutStrip, revealOffset, tabsOf, type DragGeometry } from "./stripGroups";
import { StripGroup } from "./StripGroup";
import { DraggableChip } from "./TabChip";
import { FLARE, GAP } from "./tokens";

type Hold = { chip: number; end: number };

const stripEnd = ({ slots, lefts }: DragGeometry) => (slots.length ? lefts.at(-1)! + slots.at(-1)!.width : 0);

export const StripPage = memo(function StripPage({ profileId, slot, pageWidth, current, resting }: { profileId: string; slot: number; pageWidth: number; current: boolean; resting: boolean }) {
  const windowId = useWindowId();
  const flare = useContext(FloatingStrip) ? 0 : FLARE;
  const pageStyle = usePageStyle(windowId, slot, pageWidth + flare * 2);
  const parsed = useStripEntries(windowId, profileId);
  const activeId = useShownTabIdFor(windowId, profileId);
  const groupIds = parsed.flatMap((e) => (e.kind === "group" ? [e.id] : []));
  const chipWidths = useMeasuredWidths(groupIds.map(chipKey));
  const folderIds = parsed.flatMap((e) => (e.kind === "group" ? e.members.flatMap((m) => (m.kind === "folder" ? [m.id] : [])) : []));
  const folderWidths = useMeasuredWidths(folderIds.map(folderKey));
  const chipOf = (groupId: string) => chipWidths[groupIds.indexOf(groupId)];
  const folderChip = (groupId: string) => folderWidths[folderIds.indexOf(groupId)];
  const dockEntry = parsed.find((e) => e.kind === "dock");
  const dock = useMemo(() => layoutDock(dockEntry), [dockEntry]);
  const pointerIn = useRef(false);
  const held = useRef<Hold | null>(null);
  const last = useRef<Hold & { count: number }>(null);
  const closedTo = useRef("");
  const [releases, release] = useReducer((n: number) => n + 1, 0);
  const count = parsed.reduce((n, e) => n + (e.kind === "dock" ? 0 : e.kind === "group" ? e.members.flatMap(tabsOf).length : tabsOf(e).length), 0);
  if (pointerIn.current && last.current && count < last.current.count) {
    held.current ??= { chip: last.current.chip, end: last.current.end };
    closedTo.current = activeId;
  }
  const { chip, top, targets, memberWidth, spanOf: spanInStrip } = layoutStrip(parsed, activeId, pageWidth, { groupChip: chipOf, folderChip }, dock, held.current?.chip);
  last.current = { count, chip, end: stripEnd(top) };
  const spare = held.current ? Math.max(0, held.current.end - stripEnd(top)) : 0;
  const leave = () => {
    pointerIn.current = false;
    if (!held.current) return;
    held.current = null;
    release();
  };
  const slotOf = (id: string) => top.slots.findIndex((slot) => slot.tabIds[0] === id);
  const grow = useRef(new Animated.Value(0)).current;
  const strip: Strip = { top, targets, chip, grow, dock };
  const incoming = useIncomingTab(windowId, current, top);
  const scroll = useRef<ScrollView>(null);
  const scrolled = useRef(0);
  const viewport = useRef(pageWidth + flare * 2);
  const [atStart, setAtStart] = useState(true);
  const inset = atStart ? flare : 0;
  const spanOf = (tabId: string): [number, number] | null => {
    const span = spanInStrip(tabId);
    return span && [inset + span[0], span[1]];
  };
  const latestSpan = useRef(spanOf);
  latestSpan.current = spanOf;
  const revealed = useRef(activeId);
  useEffect(() => {
    if (revealed.current === activeId || (held.current && closedTo.current === activeId)) return;
    revealed.current = activeId;
    if (!current || !activeId || tabDragging()) return;
    const frame = requestAnimationFrame(() => {
      const span = latestSpan.current(activeId);
      const x = span && revealOffset(span[0], span[1], scrolled.current, viewport.current, flare + GAP);
      if (x !== null) scroll.current?.scrollTo({ x, animated: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeId, current, releases]);
  let slotIndex = 0;
  const gap = (i: number) => (incoming.active ? <IncomingGap key={`gap${i}`} open={incoming.at === i} width={chip} origin={i === 0 ? incoming.origin : undefined} /> : null);

  return (
    <Animated.View
      pointerEvents={current ? "auto" : "none"}
      onMouseEnter={() => void (pointerIn.current = true)}
      onMouseLeave={leave}
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
              onLayout={(e) => void (viewport.current = e.nativeEvent.layout.width)}
              onScroll={(e) => {
                if (Math.abs(e.nativeEvent.contentOffset.x - scrolled.current) >= 1) dismissStripHoverIn(windowId);
                scrolled.current = e.nativeEvent.contentOffset.x;
                setAtStart(scrolled.current < 0.5);
              }}
              style={{ flex: 1, marginLeft: flare - inset }}
              contentContainerStyle={{ alignItems: "flex-start", gap: GAP, paddingLeft: inset, paddingRight: flare }}
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
              {spare ? <View style={{ width: spare, marginLeft: -GAP }} /> : null}
            </ScrollView>
          </DockContext.Provider>
        </ThemeScope>
      </PageProfileContext.Provider>
    </Animated.View>
  );
});
