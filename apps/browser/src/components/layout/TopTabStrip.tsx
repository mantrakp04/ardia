import { ContextMenuArea, FadeLabel, raiseView, setTrafficLightsCenter, Surface, Symbol, WindowDragRegion } from "@ardia/shell";
import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, findNodeHandle, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { create } from "zustand";
import { closeTab, toggleMute } from "../../lib/actions";
import { hex, layout, ThemeScope, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { PageProfileContext, useIsActiveTab, usePageProfileId, useSettings, useTab, useTabLive, useWindowId, useWindowProfileId } from "../../store/hooks";
import { ProfileIndicator, useProfileIndicatorWidth } from "../ProfileIndicator";
import { HoverSlot } from "../HoverSlot";
import { IconButton, useHover } from "../primitives";
import { clickTab } from "../sidebar/actions";
import { openGroupMenu, openTabMenu } from "../sidebar/menus";
import { groupLabel } from "../../store/organize";
import { TabIcon } from "../sidebar/TabIcon";
import { TabBadges } from "../media/TabBadges";
import { GROUP_COLORS, NEUTRAL_GROUP_SWATCH, useSidebarTokens, withAlpha } from "../sidebar/tokens";
import { modifiersOf } from "./controls";
import { usePageStyle, usePagerPages } from "./profilePager";
import { ProfileSwipeArea } from "./ProfileSwipe";
import { openNewTabInSplit } from "./splitActions";
import { toggleNewTabBar } from "../omnibox/newTabBar";
import { setMeasuredWidth, useMeasuredWidth, useMeasuredWidths } from "./measuredWidths";
import { openFolderMenu, openTileFolderStripMenu } from "./stripFolderMenu";
import { FolderMosaic } from "../sidebar/FolderTile";
import { openTileFolderMenu } from "../sidebar/tileFolderUi";
import { folderCell, folderIdOfCell, folderIn, folderLabel } from "../../store/tileFolders";
import { usePeek } from "./usePeek";
import { lightsCenter, TOP_STRIP_LIGHTS_CENTER } from "./dockMotion";
import {
  aimDrop,
  dragGeometry,
  dragRange,
  dropIndex,
  GROUP_MARGIN_LEFT,
  GROUP_MARGIN_RIGHT,
  GROUP_SPRING,
  groupLayout,
  leaveIndex,
  MEMBERS_INSET,
  memberInteractive,
  moveIndex,
  stripEntries,
  stripTabWidth,
  TAIL_EXPANDED,
  TUCK_FADE_MS,
  tuckTarget,
  type DragGeometry,
  type DragSlot,
} from "./stripGroups";
import { makeRoom, registerSlot, reorderOffsets, settleRoom, shiftRoom, SLIDE } from "./stripReorder";
import { beginExternalDrag, beginTabDrag, cancelTabDrag, endExternalDrag, endTabDrag, moveExternalDrag, setDragPicture, setInsert, setInsertResolver, updateTabDrag, useTabDrag } from "./tabDrag";
import { TabDropArea, type TabDropTarget } from "./fileDrop";
import { toolbarPalette, useEasedColor, type ToolbarPalette } from "./toolbarColors";

export const TOP_STRIP_HEIGHT = 42;
export const TOP_CARD_INSET = 6;
const MID = 21;
const ITEM_HEIGHT = 32;
const ITEM_TOP = MID - ITEM_HEIGHT / 2;
const TAB_TOP = 3;
const TAB_RADIUS = 10;
const FLARE = 15;
const RIM_HEIGHT = 27.5;
const PEEK_PAD = 7;
const PEEK_HEIGHT = ITEM_HEIGHT + PEEK_PAD * 2;
const PEEK_BORDER = 0.5;
const PINNED_CELL = 34;
const PINNED_SPACING = 2;
const DOCK_GAP = 4.5;
const MIN_CHIP = 96;
const MAX_CHIP = 173;
const GAP = 4;
const FOLDER_HEIGHT = 24;
const FOLDER_RADIUS = 7;
const LIFT_SLOP = 12;
const LIFT_MS = 150;
const LIGHTS_GAP = 8;
const ONTO_EDGE = MAX_CHIP / 4;

const FloatingStrip = createContext(false);

type Member = { kind: "tab"; id: string; group: string | null } | { kind: "split" | "folder"; id: string; tabIds: string[]; group: string | null };
type GroupEntry = { kind: "group"; id: string; collapsed: boolean; members: Member[] };
type Entry = { kind: "dock"; ids: string[]; members: Map<string, string[]> } | GroupEntry | Member;
type DropTarget = { kind: "tab" | "group"; id: string };

const useStripOnto = create<{ key: string | null }>(() => ({ key: null }));
const ontoKey = (target: DropTarget | null) => (target ? `${target.kind}:${target.id}` : null);
const useOnto = (target: DropTarget) => useStripOnto((s) => s.key === ontoKey(target));

const PROFILE_ROOM = 140;
const DOWNLOADS_BOX = 34;
const CONTROLS_GAP = 2;

export function TopTabStrip({ width, floating = false, hidden = false, swipe = true }: { width: number; floating?: boolean; hidden?: boolean; swipe?: boolean }) {
  const windowId = useWindowId();
  const current = useWindowProfileId();
  const { pages } = usePagerPages(windowId);
  const profileChip = useProfileIndicatorWidth(PROFILE_ROOM);
  const controls = (profileChip ? profileChip + CONTROLS_GAP : 0) + DOWNLOADS_BOX;
  const left = floating ? 8 : layout.trafficLightsWidth + LIGHTS_GAP;
  const right = Math.max(84, controls + 8 + 6);
  const pageWidth = Math.max(0, width - left - right);
  const flare = floating ? 0 : FLARE;

  useEffect(() => {
    if (floating || hidden) return;
    void setTrafficLightsCenter(windowId, [...TOP_STRIP_LIGHTS_CENTER]);
    return () => void setTrafficLightsCenter(windowId, null);
  }, [floating, hidden, windowId]);

  return (
    <FloatingStrip.Provider value={floating}>
      <StripDropArea style={{ height: TOP_STRIP_HEIGHT }}>
        <WindowDragRegion style={StyleSheet.absoluteFill} />
        <View style={{ position: "absolute", left: left - flare, right: Math.max(right - flare, controls + 8), top: 0, bottom: 0, overflow: "hidden" }}>
          {pages.map((page) => (
            <StripPage key={page.id} profileId={page.id} slot={page.slot} pageWidth={pageWidth} current={page.id === current} resting={!!page.resting} />
          ))}
        </View>
        <View mouseDownCanMoveWindow={false} style={{ position: "absolute", right: 8, top: MID - 17, flexDirection: "row", alignItems: "center", gap: CONTROLS_GAP }}>
          <ProfileIndicator room={PROFILE_ROOM} />
          <IconButton
            icon="arrow.down.circle"
            size={16}
            box={DOWNLOADS_BOX}
            radius={10}
            tooltip="Downloads (⇧⌘J)"
            onPress={() => {
              const s = useBrowser.getState();
              s.setDownloadsOpen(windowId, !s.windowUi[windowId]?.downloadsOpen);
            }}
          />
        </View>
        {swipe && <ProfileSwipeArea surface="strip" style={StyleSheet.absoluteFill} pageWidth={pageWidth + flare * 2} />}
        {!floating && <StripDropHighlight left={left} right={right} />}
      </StripDropArea>
    </FloatingStrip.Provider>
  );
}

function StripDropArea({ style, children }: { style: ViewStyle; children: React.ReactNode }) {
  const windowId = useWindowId();
  const target: TabDropTarget = {
    windowId,
    enter: (_, at, token) => beginExternalDrag(windowId, at, token),
    move: (at, token) => moveExternalDrag(windowId, at, token),
    leave: (token) => void endExternalDrag(windowId, null, token),
    drop: (at, token) => {
      const beforeId = endExternalDrag(windowId, at, token);
      return beforeId === undefined ? null : { pinned: false, beforeId };
    },
  };
  return (
    <TabDropArea target={target} style={style}>
      {children}
    </TabDropArea>
  );
}

function StripDropHighlight({ left, right }: { left: number; right: number }) {
  const windowId = useWindowId();
  const theme = useTheme();
  const over = useTabDrag((d) => d.overWindow === windowId);
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(glow, { toValue: over ? 1 : 0, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [over]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: left - 4,
        right: right - 4,
        top: ITEM_TOP - 1,
        height: ITEM_HEIGHT + 2,
        borderRadius: TAB_RADIUS + 1,
        borderWidth: 1.5,
        borderColor: theme.accent,
        backgroundColor: theme.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
        opacity: glow,
      }}
    />
  );
}

function useIncomingTab(windowId: string, current: boolean, top: DragGeometry) {
  const active = useTabDrag((d) => current && d.tabIds.length > 0 && d.windowId !== windowId);
  const point = useTabDrag((d) => (current && d.overWindow === windowId ? d.overPoint : null));
  const origin = useRef<View>(null);
  const [start, setStart] = useState<number | null>(null);
  useEffect(() => {
    if (!point) return setStart(null);
    origin.current?.measureInWindow((x) => setStart((old) => (old === x ? old : x)));
  }, [point?.[0], point?.[1]]);
  const index = incomingIndex(top, point, start);
  const beforeId = index === null ? undefined : (top.slots[index]?.tabIds[0] ?? null);
  useEffect(() => setInsert(windowId, beforeId), [beforeId, windowId]);
  const latest = useRef({ top, start });
  latest.current = { top, start };
  useEffect(() => {
    if (!current) return;
    setInsertResolver(windowId, (p) => {
      const i = incomingIndex(latest.current.top, p, latest.current.start);
      return i === null ? undefined : (latest.current.top.slots[i]?.tabIds[0] ?? null);
    });
    return () => {
      setInsertResolver(windowId, null);
      setInsert(windowId, undefined);
    };
  }, [windowId, current]);
  return { active, at: index, origin };
}

function incomingIndex(top: DragGeometry, point: [number, number] | null, start: number | null): number | null {
  if (!point || start === null || point[1] > TOP_STRIP_HEIGHT + 24) return null;
  const x = point[0] - start;
  let index = top.slots.filter((slot, i) => top.lefts[i]! + slot.width / 2 < x).length;
  const groups = useBrowser.getState().groups;
  const pinnedGroup = (id: string | undefined) => !!id && Object.values(groups).some((g) => g.pinned && g.tabIds.includes(id));
  while (index < top.slots.length && pinnedGroup(top.slots[index]!.tabIds[0])) index++;
  return index;
}

function IncomingGap({ open, width, origin }: { open: boolean; width: number; origin?: React.RefObject<View | null> }) {
  const room = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(room, { toValue: open ? 1 : 0, duration: 120, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [open]);
  return (
    <Animated.View
      ref={origin}
      pointerEvents="none"
      style={{
        height: TOP_STRIP_HEIGHT,
        width: room.interpolate({ inputRange: [0, 1], outputRange: [0, width] }),
        marginRight: room.interpolate({ inputRange: [0, 1], outputRange: [-GAP, 0] }),
      }}
    />
  );
}

function StripPage({ profileId, slot, pageWidth, current, resting }: { profileId: string; slot: number; pageWidth: number; current: boolean; resting: boolean }) {
  const windowId = useWindowId();
  const flare = useContext(FloatingStrip) ? 0 : FLARE;
  const pageStyle = usePageStyle(windowId, slot, pageWidth + flare * 2);
  const entries = useBrowser((s) => stripEntries(s, windowId, profileId));
  const activeId = useBrowser((s) => s.windows[windowId]?.activeTabIds[profileId] ?? "");
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
              horizontal
              showsHorizontalScrollIndicator={false}
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
}

function parseEntries(keys: string[]): Entry[] {
  const out: Entry[] = [];
  const groups = new Map<string, GroupEntry>();
  for (const key of keys) {
    const [kind, id, a, b] = key.split(":");
    if (kind === "pinned" || kind === "tilefolder") {
      const cell = kind === "tilefolder" ? folderCell(id!) : id!;
      const last = out[out.length - 1];
      const dock = last?.kind === "dock" ? last : { kind: "dock" as const, ids: [], members: new Map<string, string[]>() };
      if (dock !== last) out.push(dock);
      dock.ids.push(cell);
      if (kind === "tilefolder") dock.members.set(cell, a!.split(","));
      continue;
    }
    if (kind === "group") {
      const group: GroupEntry = { kind, id: id!, collapsed: a === "1", members: [] };
      groups.set(group.id, group);
      out.push(group);
      continue;
    }
    const member: Member = kind === "split" || kind === "folder" ? { kind, id: id!, tabIds: a!.split(","), group: b || null } : { kind: "tab", id: id!, group: a || null };
    const group = member.group ? groups.get(member.group) : undefined;
    if (group) group.members.push(member);
    else out.push(member);
  }
  return out;
}

const chipKey = (groupId: string) => `strip-group-chip|${groupId}`;
const folderKey = (groupId: string) => `strip-folder-chip|${groupId}`;
const holds = (m: Member, tabId: string) => (m.kind === "tab" ? m.id === tabId : m.tabIds.includes(tabId));
const tabsOf = (m: Member) => (m.kind === "tab" ? [m.id] : m.tabIds);
const units = (m: Member, activeId: string) => (m.kind === "split" ? Math.min(m.tabIds.length, 2) : m.kind === "folder" ? (holds(m, activeId) ? 1 : 0) : 1);

type StripDrag = {
  tabId: string | null;
  ids: () => string[];
  pinned: boolean;
  groupId: string | null;
  geometry: DragGeometry;
  from: number;
  width: number;
  gap: number;
  axis?: "x" | "y";
  range?: [number, number] | ((grab: number) => [number, number]);
  drop?: (dx: number, ids: string[]) => boolean;
  cross?: Cross;
  targets?: (DropTarget | null)[];
  levels?: number;
  local?: boolean;
};

type Landing = { dx: number; commit: () => void };
type Cross = { at: (dx: number, grab: number) => boolean; land: (dx: number, grab: number, ids: string[]) => Landing | null; clear: () => void };

type Dock = { ids: string[]; left: number; geometry: DragGeometry };
type Strip = { dock: Dock | null; top: DragGeometry; targets: (DropTarget | null)[]; chip: number; grow: Animated.Value };
const CELL_STEP = PINNED_CELL + PINNED_SPACING;
const dockWidth = (cells: number) => cells * CELL_STEP - PINNED_SPACING;
const DockContext = createContext<Strip | null>(null);

const growTargets = new WeakMap<Animated.Value, number>();
function growDock(grow: Animated.Value, to: number) {
  if ((growTargets.get(grow) ?? 0) === to) return;
  growTargets.set(grow, to);
  Animated.spring(grow, { toValue: to, ...SLIDE }).start();
}

function settleStrip({ top, dock, grow }: Strip) {
  settleRoom(top);
  if (dock) settleRoom(dock.geometry);
  grow.stopAnimation();
  grow.setValue(0);
  growTargets.set(grow, 0);
}

const slotStart = ({ slots, lefts }: DragGeometry, k: number) =>
  k < slots.length ? lefts[k]! - (slots[k]!.marginLeft ?? 0) : slots.length ? lefts.at(-1)! + slots.at(-1)!.width + (slots.at(-1)!.marginRight ?? 0) + GAP : 0;

const dockShrink = (dock: Dock) => (dock.ids.length > 1 ? CELL_STEP : PINNED_CELL + DOCK_GAP);

function pinOutIndex({ dock, top }: Strip, from: number, dx: number): number | null {
  if (!dock) return null;
  const left = dock.left + dock.geometry.lefts[from]! + dx;
  if (left < -DOCK_GAP) return null;
  const shrink = dockShrink(dock);
  return top.slots.filter((slot, i) => top.lefts[i]! - shrink + slot.width / 2 < left).length;
}

function pinOut(strip: () => Strip | null, from: number): Cross {
  return {
    at: (dx) => {
      const s = strip();
      const k = s ? pinOutIndex(s, from, dx) : null;
      if (!s?.dock || k === null) return false;
      const shrink = dockShrink(s.dock);
      shiftRoom(s.dock.geometry, (i) => (i > from ? -CELL_STEP : 0), from);
      shiftRoom(s.top, (i) => -shrink + (i >= k ? s.chip + GAP : 0));
      growDock(s.grow, s.dock.ids.length > 1 ? -CELL_STEP : -PINNED_CELL);
      return true;
    },
    land: (dx, _, ids) => {
      const s = strip();
      const k = s ? pinOutIndex(s, from, dx) : null;
      if (!s?.dock || k === null) return null;
      const target = slotStart(s.top, k) - dockShrink(s.dock);
      return {
        dx: target - (s.dock.left + s.dock.geometry.lefts[from]!),
        commit: () => {
          settleStrip(s);
          useBrowser.getState().placeTabs(ids, { pinned: false, beforeId: s.top.slots[k]?.tabIds[0] ?? null });
        },
      };
    },
    clear: () => {
      const s = strip();
      if (!s) return;
      shiftRoom(s.top, () => 0);
      growDock(s.grow, 0);
    },
  };
}

const dockCellLeft = ({ lefts }: DragGeometry, j: number) => (j < lefts.length ? lefts[j]! : (lefts.at(-1) ?? -CELL_STEP) + CELL_STEP);

function tabInIndex({ dock, top }: Strip, from: number, dx: number, grab: number): number | null {
  if (!dock || from < 0) return null;
  const left = top.lefts[from]! + dx;
  if (left >= -DOCK_GAP) return null;
  const tile = Math.min(left + grab - PINNED_CELL / 2, dock.left + dock.ids.length * CELL_STEP);
  return dock.ids.filter((_, i) => dock.left + dock.geometry.lefts[i]! + PINNED_CELL / 2 < tile).length;
}

function tabIn(strip: () => Strip | null, from: number, width: number): Cross {
  return {
    at: (dx, grab) => {
      const s = strip();
      const j = s ? tabInIndex(s, from, dx, grab) : null;
      if (!s?.dock || j === null) return false;
      shiftRoom(s.dock.geometry, (i) => (i >= j ? CELL_STEP : 0));
      shiftRoom(s.top, (i) => CELL_STEP - (i > from ? width + GAP : 0), from);
      growDock(s.grow, CELL_STEP);
      return true;
    },
    land: (dx, grab, ids) => {
      const s = strip();
      const j = s ? tabInIndex(s, from, dx, grab) : null;
      if (!s?.dock || j === null) return null;
      const target = s.dock.left + dockCellLeft(s.dock.geometry, j);
      return {
        dx: target - (s.top.lefts[from]! + grab - PINNED_CELL / 2),
        commit: () => {
          settleStrip(s);
          useBrowser.getState().placeTabs(ids, { pinned: true, beforeId: s.dock!.geometry.slots[j]?.tabIds[0] ?? null });
        },
      };
    },
    clear: () => {
      const s = strip();
      if (!s?.dock) return;
      shiftRoom(s.dock.geometry, () => 0);
      growDock(s.grow, 0);
    },
  };
}

const tileHold = (dx: Animated.Value, limit: number) =>
  dx.interpolate({ inputRange: [limit, limit + 1], outputRange: [0, -1], extrapolateLeft: "clamp", extrapolateRight: "extend" });

function FadeIn({ style, children }: { style: object; children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 100, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, []);
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", ...style, opacity }}>
      {children}
    </Animated.View>
  );
}

function useStripDrag(item: StripDrag) {
  const dx = useRef(new Animated.Value(0)).current;
  const shift = useRef(new Animated.Value(0)).current;
  const translateX = useRef(Animated.add(dx, shift)).current;
  const lift = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);
  const [crossed, setCrossed] = useState(false);
  const view = useRef<View>(null);
  const latest = useRef(item);
  latest.current = item;
  const drag = useRef({ stripBottom: TOP_STRIP_HEIGHT, lifted: false, ids: [] as string[], dx: 0, to: -1, grab: item.width / 2, crossed: false, onto: null as DropTarget | null });
  useEffect(() => registerSlot(() => latest.current.geometry, () => latest.current.from, shift), []);
  const aimAt = (dx: number) => {
    const { geometry, from, targets } = latest.current;
    if (!targets || from < 0) return null;
    return aimDrop(geometry, from, geometry.lefts[from]! + drag.current.grab + dx, (i) => !!targets[i], ONTO_EDGE);
  };
  const indexAt = (dx: number) => aimAt(dx)?.to ?? dropIndex(latest.current.geometry, latest.current.from, dx);
  const setOnto = (target: DropTarget | null) => {
    if (ontoKey(drag.current.onto) === ontoKey(target)) return;
    drag.current.onto = target;
    useStripOnto.setState({ key: ontoKey(target) });
  };
  const setLifted = (lifted: boolean) => {
    if (drag.current.lifted === lifted) return;
    drag.current.lifted = lifted;
    Animated.timing(lift, { toValue: lifted ? 1 : 0, duration: LIFT_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  };
  const makeRoomAt = (to: number) => {
    const { geometry, from } = latest.current;
    if (from < 0 || to === drag.current.to) return;
    drag.current.to = to;
    makeRoom(geometry, from, to < 0 ? from : to);
  };
  const setCross = (on: boolean) => {
    if (drag.current.crossed === on) return;
    drag.current.crossed = on;
    if (!on) {
      latest.current.cross?.clear();
      drag.current.to = NaN;
    }
    setCrossed(on);
  };
  const owns = useRef(false);
  const raised = useRef<number | null>(null);
  const raise = (on: boolean) => {
    const tag = on ? findNodeHandle(view.current) : raised.current;
    raiseView(tag, latest.current.levels ?? (latest.current.groupId ? 1 : 0), on);
    raised.current = on ? tag : null;
  };
  const reset = () => {
    owns.current = false;
    setCross(false);
    setOnto(null);
    makeRoomAt(-1);
    dx.setValue(0);
    setLifted(false);
    setDragging(false);
    raise(false);
  };
  const settle = useRef<{ land: () => void } | null>(null);
  const settleInto = (to: number | null, commit: () => boolean) => {
    const { geometry, from } = latest.current;
    if (to === null) makeRoomAt(-1);
    const landing = {
      land: () => {
        if (settle.current !== landing) return;
        settle.current = null;
        if (to !== null) {
          settleRoom(geometry);
          commit();
        }
        dx.setValue(0);
        setDragging(false);
        raise(false);
      },
    };
    settle.current = landing;
    Animated.spring(dx, { toValue: to === null ? 0 : (reorderOffsets(geometry, from, to)[from] ?? 0), ...SLIDE }).start(() => landing.land());
  };
  const settleAcross = ({ dx: toValue, commit }: Landing) => {
    const landing = {
      land: () => {
        if (settle.current !== landing) return;
        settle.current = null;
        commit();
        drag.current.crossed = false;
        setCrossed(false);
        dx.setValue(0);
        setDragging(false);
        raise(false);
      },
    };
    settle.current = landing;
    Animated.spring(dx, { toValue, ...SLIDE }).start(() => landing.land());
  };
  useEffect(
    () => () => {
      settle.current?.land();
      if (!owns.current) return;
      setOnto(null);
      if (drag.current.crossed) latest.current.cross?.clear();
      settleRoom(latest.current.geometry);
      if (!latest.current.local) cancelTabDrag();
    },
    [],
  );
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => {
          if (useTabDrag.getState().tabIds.length) return false;
          const axis = latest.current.axis;
          if (axis === "y") return Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx);
          if (axis === "x") return Math.abs(g.dx) > 4;
          return Math.abs(g.dx) > 4 || Math.abs(g.dy) > 6;
        },
        onPanResponderGrant: (e) => {
          const ids = latest.current.ids();
          const grab: [number, number] = [e.nativeEvent.pageX, e.nativeEvent.pageY];
          settle.current?.land();
          dx.stopAnimation();
          dx.setValue(0);
          const mine = { stripBottom: TOP_STRIP_HEIGHT, lifted: false, ids, dx: 0, to: -1, grab: latest.current.width / 2, crossed: false, onto: null };
          setOnto(null);
          drag.current = mine;
          owns.current = true;
          setDragging(true);
          if (latest.current.from >= 0) raise(true);
          if (latest.current.local) return;
          const seq = beginTabDrag(ids.length === 1 ? latest.current.tabId : null, ids);
          view.current?.measureInWindow((x, y, width, height) => {
            if (drag.current !== mine) return;
            mine.stripBottom = y + TOP_STRIP_HEIGHT;
            mine.grab = Math.max(0, Math.min(width, grab[0] - x));
            setDragPicture(seq, () => [x + mine.dx, y, width, height], [grab[0] + mine.dx, grab[1]]);
          });
        },
        onPanResponderMove: (_, g) => {
          const { geometry, from, tabId, range, local, cross } = latest.current;
          const lifted = !local && !!tabId && drag.current.ids.length === 1 && g.moveY > drag.current.stripBottom + LIFT_SLOP;
          setLifted(lifted);
          const [min, max] = (typeof range === "function" ? range(drag.current.grab) : range) ?? (from < 0 ? [0, 0] : dragRange(geometry, from));
          if (!lifted) {
            drag.current.dx = Math.max(min, Math.min(max, g.dx));
            dx.setValue(drag.current.dx);
          }
          const across = !lifted && !!cross?.at(drag.current.dx, drag.current.grab);
          setCross(across);
          const aim = across || lifted ? null : aimAt(g.dx);
          setOnto(aim?.onto != null ? (latest.current.targets?.[aim.onto] ?? null) : null);
          if (!across) makeRoomAt(lifted || from < 0 ? -1 : (aim?.to ?? dropIndex(geometry, from, g.dx)));
          if (!local) updateTabDrag(g.moveX, g.moveY, lifted);
        },
        onPanResponderRelease: (_, g) => {
          const lifted = drag.current.lifted;
          const { local, drop, from, range, geometry } = latest.current;
          owns.current = false;
          if ((!local && (endTabDrag() || lifted)) || (from < 0 && !drop)) return reset();
          const ids = drag.current.ids;
          const landing = drag.current.crossed ? latest.current.cross?.land(drag.current.dx, drag.current.grab, ids) : null;
          if (landing) return settleAcross(landing);
          setCross(false);
          const onto = drag.current.onto;
          setOnto(null);
          if (!local && onto && dropOnto(onto, ids)) {
            settleRoom(geometry);
            return reset();
          }
          const bounds = typeof range === "function" ? range(drag.current.grab) : range;
          const travelled = bounds ? Math.max(bounds[0], Math.min(bounds[1], g.dx)) : g.dx;
          if (!local) {
            const store = useBrowser.getState();
            const moved = drop?.(travelled, ids) || (from >= 0 && ids.length > 1 && reorder(ids, latest.current, indexAt(g.dx)));
            if (moved && useBrowser.getState() !== store) settleRoom(geometry);
            if (moved) return reset();
          }
          if (from < 0) return reset();
          const to = indexAt(g.dx);
          settleInto(to === from ? null : to, () => {
            const store = useBrowser.getState();
            if (local) drop?.(travelled, ids);
            else reorder(ids, latest.current, to);
            return useBrowser.getState() !== store;
          });
        },
        onPanResponderTerminate: () => {
          const local = latest.current.local;
          reset();
          if (!local) cancelTabDrag();
        },
      }),
    [],
  );
  const style = {
    zIndex: dragging ? 10 : 0,
    opacity: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    marginRight: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -(item.width + item.gap)] }),
    transform: [{ translateX }],
  };
  return { ref: view, panHandlers: responder.panHandlers, style, dragging, crossed, grab: drag.current.grab, dx };
}

function reorder(ids: string[], { geometry, from, pinned, groupId }: StripDrag, to: number): boolean {
  const s = useBrowser.getState();
  const tab = s.tabs[ids[0] ?? ""];
  const w = tab && s.windows[tab.windowId];
  if (!tab || !w) return false;
  if (ids.length === 1) {
    const section = w.tabIds.filter((id) => s.tabs[id]?.profileId === tab.profileId && !!s.tabs[id]?.pinned === pinned);
    const index = moveIndex(section, tab.id, geometry.slots, from, to);
    if (index === null) return false;
    s.moveTab(tab.id, index);
    return true;
  }
  if (to === from) return false;
  const others = geometry.slots.filter((_, i) => i !== from);
  let beforeId = others.slice(to).flatMap((slot) => slot.tabIds).find((id) => !ids.includes(id)) ?? null;
  if (!beforeId) {
    const last = w.tabIds.indexOf(others.at(-1)?.tabIds.at(-1) ?? "");
    beforeId = last < 0 ? null : (w.tabIds.slice(last + 1).find((id) => !ids.includes(id)) ?? null);
  }
  s.placeTabs(ids, { pinned, beforeId, groupId });
  return true;
}

function dropOnto(target: DropTarget, ids: string[]): boolean {
  const s = useBrowser.getState();
  if (target.kind === "tab") return !!s.groupOnto(ids, target.id);
  const before = s.groups[target.id]?.tabIds;
  s.placeTabs(ids, { pinned: false, groupId: target.id });
  return useBrowser.getState().groups[target.id]?.tabIds !== before;
}

function withSelection(tabId: string): string[] {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  const selection = tab ? (s.selection[tab.windowId] ?? []) : [];
  if (selection.length < 2 || !selection.includes(tabId)) return [tabId];
  return s.windows[tab!.windowId]!.tabIds.filter((id) => selection.includes(id) && !!s.tabs[id]?.pinned === tab!.pinned);
}

type GroupOut = { top: DragGeometry; slot: number; chip: number; expanded: boolean; left: number };

function DraggableChip({
  tabId,
  width,
  geometry,
  from,
  group,
  tuck,
  out,
}: {
  tabId: string;
  width: number;
  geometry: DragGeometry;
  from: number;
  group: string | null;
  tuck?: () => void;
  out?: GroupOut;
}) {
  const active = useIsActiveTab(tabId);
  const strip = useContext(DockContext);
  const latestStrip = useRef(strip);
  latestStrip.current = strip;
  const dock = !group && from >= 0 ? (strip?.dock ?? null) : null;
  const member = group && out && out.slot >= 0 ? out : null;
  const stripEnd = member ? member.top.lefts.at(-1)! + member.top.slots.at(-1)!.width : 0;
  const range: StripDrag["range"] = dock
    ? (grab) => [Math.min(0, dock.left - geometry.lefts[from]! - grab + PINNED_CELL / 2), dragRange(geometry, from)[1]]
    : member
      ? [member.top.lefts[0]! - member.left - width / 2, stripEnd - member.left - width / 2]
      : undefined;
  const drag = useStripDrag({
    tabId,
    ids: () => withSelection(tabId),
    pinned: false,
    groupId: group,
    geometry,
    from,
    width,
    gap: GAP,
    range,
    cross: dock ? tabIn(() => latestStrip.current, from, width) : undefined,
    targets: !group && from >= 0 ? strip?.targets : undefined,
    drop: (dx, ids) => {
      if (!member) return false;
      const at = leaveIndex(member.top, member.slot, member.chip, member.expanded, member.left + dx, width);
      if (at === null) return false;
      const beforeId = member.top.slots.slice(at).flatMap((slot) => slot.tabIds).find((id) => !ids.includes(id)) ?? null;
      useBrowser.getState().placeTabs(ids, { pinned: false, beforeId, groupId: null });
      return true;
    },
  });
  return (
    <Animated.View ref={drag.ref} {...drag.panHandlers} mouseDownCanMoveWindow={false} style={{ ...drag.style, zIndex: drag.dragging ? 10 : active ? 1 : 0 }}>
      <View style={{ opacity: drag.crossed ? 0 : 1 }}>
        <TabChip tabId={tabId} width={width} tuck={tuck} dragged={drag.dragging} />
      </View>
      {drag.crossed && dock && (
        <FadeIn
          style={{
            left: drag.grab - PINNED_CELL / 2,
            top: ITEM_TOP + 0.5,
            transform: [{ translateX: tileHold(drag.dx, dock.left + dock.ids.length * CELL_STEP - geometry.lefts[from]! - drag.grab + PINNED_CELL / 2) }],
          }}
        >
          <PinnedFace tabId={tabId} active={active} hovered={false} pressed={false} />
        </FadeIn>
      )}
    </Animated.View>
  );
}

function useWebsiteBand(tabId: string) {
  const theme = useTheme();
  const extend = useSettings((s) => s.extendWebsiteColor);
  const url = useTab(tabId)?.url;
  const themeColor = useTabLive(tabId, (l) => l.themeColor);
  const palette = toolbarPalette(theme, extend && url ? themeColor : null);
  return { palette, band: useEasedColor(palette.background) };
}

function TabChip({ tabId, width, tuck, dragged }: { tabId: string; width: number; tuck?: () => void; dragged: boolean }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const tab = useTab(tabId);
  const onto = useOnto({ kind: "tab", id: tabId });
  const active = useIsActiveTab(tabId);
  const floating = useContext(FloatingStrip);
  const playing = useTabLive(tabId, (l) => l.playingAudio);
  const { palette, band } = useWebsiteBand(tabId);
  const { hovered, hoverProps } = useHover();
  if (!tab) return null;
  const title = tab.customTitle || tab.title || tab.url || "New Tab";
  const onBand = active && !floating && !!palette.background;
  return (
    <View {...hoverProps} tooltip={tab.url ? `${title}\n${tab.url}` : title} style={{ width, height: TOP_STRIP_HEIGHT }}>
      {active && <SelectedTab width={width} band={band} opaque={dragged} />}
      {dragged && !active && (
        <View pointerEvents="none" style={{ position: "absolute", left: 0, width, top: ITEM_TOP, height: ITEM_HEIGHT, borderRadius: TAB_RADIUS, backgroundColor: theme.windowTint[0] }} />
      )}
      {onto && <OntoRing width={width} />}
      <ContextMenuArea onContextMenu={() => void openTabMenu(windowId, tab)} style={StyleSheet.absoluteFill}>
        <Pressable onPress={(e) => clickTab(windowId, tab.id, modifiersOf(e))} style={{ flex: 1 }}>
          {({ pressed }) => (
            <ItemRow hovered={(hovered || dragged) && !active && !onto} pressed={pressed && !active}>
              <View pointerEvents="none">
                <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
                <TabBadges tabId={tab.id} pip={false} />
              </View>
              {(playing || tab.muted) && (
                <Pressable onPress={() => toggleMute(tab.id)} style={{ marginLeft: 5 }} tooltip={tab.muted ? "Unmute" : "Mute"}>
                  <Symbol name={tab.muted ? "speaker.slash" : "speaker.wave.2"} size={11} color={onBand ? palette.icon : theme.textTab} style={{ width: 16, height: 16 }} />
                </Pressable>
              )}
              <FadeLabel
                text={title}
                fontSize={12}
                color={onBand ? palette.text : active ? theme.tabSelectedText : theme.textTab}
                style={{ flex: 1, height: 16, marginLeft: 5 }}
              />
              <HoverSlot
                hovered={hovered}
                width={20}
                hover={
                  <IconButton
                    icon={tuck ? "minus" : "xmark"}
                    size={9}
                    weight="semibold"
                    box={20}
                    radius={5}
                    color={onBand ? palette.icon : undefined}
                    onPress={tuck ?? (() => void closeTab(tab.id))}
                    tooltip={tuck ? "Hide in Group" : "Close Tab"}
                  />
                }
              />
            </ItemRow>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}

function OntoRing({ width }: { width: number | Animated.Value }) {
  const theme = useTheme();
  return (
    <FadeIn
      style={{
        left: 0,
        top: ITEM_TOP,
        width,
        height: ITEM_HEIGHT,
        borderRadius: TAB_RADIUS,
        borderWidth: 1.5,
        borderColor: theme.accent,
        backgroundColor: theme.tabPressed,
      }}
    >
      {null}
    </FadeIn>
  );
}

function ItemRow({ hovered, pressed, children }: { hovered: boolean; pressed: boolean; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: ITEM_TOP,
        height: ITEM_HEIGHT,
        borderRadius: TAB_RADIUS,
        backgroundColor: pressed ? theme.tabPressed : hovered ? theme.tabHover : undefined,
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: 9.5,
        paddingRight: 6,
      }}
    >
      {children}
    </View>
  );
}

type Fill = string | ReturnType<typeof useEasedColor>;

function SelectedTab({ width, band, opaque = false }: { width: number; band: Fill | null; opaque?: boolean }) {
  const theme = useTheme();
  const floating = useContext(FloatingStrip);
  if (floating) {
    const card = {
      position: "absolute" as const,
      left: 0,
      top: ITEM_TOP,
      width,
      height: ITEM_HEIGHT,
      borderRadius: TAB_RADIUS,
    };
    return (
      <>
        {opaque && <View pointerEvents="none" style={{ ...card, backgroundColor: theme.windowTint[0] }} />}
        <View
          pointerEvents="none"
          style={{
            ...card,
            borderWidth: 0.5,
            borderColor: theme.dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.08)",
            backgroundColor: theme.card,
          }}
        />
      </>
    );
  }
  const body = width - 1;
  const fills: Fill[] = [...(opaque ? [theme.windowTint[0]] : []), theme.card, ...(band ? [band] : [])];
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width, height: TOP_STRIP_HEIGHT }}>
      {fills.map((fill, i) => (
        <Fragment key={i}>
          <Animated.View
            style={{
              position: "absolute",
              left: 0.5,
              top: TAB_TOP,
              width: body,
              height: TOP_STRIP_HEIGHT - TAB_TOP,
              borderTopLeftRadius: TAB_RADIUS,
              borderTopRightRadius: TAB_RADIUS,
              backgroundColor: fill,
            }}
          />
          <Flare x={0.5 - FLARE} side="left" color={fill} />
          <Flare x={0.5 + body} side="right" color={fill} />
        </Fragment>
      ))}
      <Surface
        cornerRadius={TAB_RADIUS + 0.5}
        borderWidth={0.5}
        borderColors={[theme.dark ? "#FFFFFF3B" : "#FFFFFFFA", "#FFFFFF00"]}
        style={{ position: "absolute", left: 0, top: TAB_TOP - 0.5, width, height: RIM_HEIGHT }}
      />
    </View>
  );
}

function Flare({ x, side, color }: { x: number; side: "left" | "right"; color: Fill }) {
  const outer = FLARE * 2;
  return (
    <View style={{ position: "absolute", left: x, top: TOP_STRIP_HEIGHT - FLARE, width: FLARE, height: FLARE, overflow: "hidden" }}>
      <Animated.View
        style={{
          position: "absolute",
          left: side === "left" ? -outer : FLARE - outer,
          top: -outer,
          width: outer * 2,
          height: outer * 2,
          borderRadius: outer,
          borderWidth: FLARE,
          borderColor: color,
        }}
      />
    </View>
  );
}

function PinnedDock({ tabIds }: { tabIds: string[] }) {
  const theme = useTheme();
  const strip = useContext(DockContext)!;
  const geometry = strip.dock!.geometry;
  const width = dockWidth(tabIds.length);
  const box = useMemo(() => Animated.add(strip.grow, width), [strip.grow, width]);
  return (
    <View style={{ marginTop: ITEM_TOP, marginRight: DOCK_GAP - GAP, zIndex: 2, width, height: ITEM_HEIGHT, flexDirection: "row", alignItems: "center" }}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          height: ITEM_HEIGHT,
          width: box.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolateLeft: "clamp" }),
          opacity: box.interpolate({ inputRange: [0, PINNED_CELL / 2], outputRange: [0, 1], extrapolate: "clamp" }),
          borderRadius: TAB_RADIUS,
          borderWidth: 0.5,
          borderColor: theme.pinnedRestingStroke,
          backgroundColor: theme.pinnedResting,
        }}
      />
      <View style={{ flexDirection: "row", gap: PINNED_SPACING }}>
        {tabIds.map((id, i) => {
          const folderId = folderIdOfCell(id);
          return folderId ? (
            <FolderCell key={id} folderId={folderId} tabIds={geometry.slots[i]?.tabIds ?? []} geometry={geometry} from={i} />
          ) : (
            <PinnedCell key={id} tabId={id} geometry={geometry} from={i} />
          );
        })}
      </View>
    </View>
  );
}

function PinnedFace({ tabId, active, hovered, pressed }: { tabId: string; active: boolean; hovered: boolean; pressed: boolean }) {
  const theme = useTheme();
  const tab = useTab(tabId);
  if (!tab) return null;
  return (
    <View style={{ width: PINNED_CELL, height: ITEM_HEIGHT - 1, alignItems: "center", justifyContent: "center" }}>
      {(active || hovered || pressed) && (
        <View
          style={{
            position: "absolute",
            left: 2,
            right: 2,
            top: 2,
            bottom: 2,
            borderRadius: 8,
            backgroundColor: pressed ? theme.tabPressed : active ? theme.pinnedSelectedFill : theme.tabHover,
          }}
        />
      )}
      <View pointerEvents="none">
        <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
        <TabBadges tabId={tab.id} pip={false} />
      </View>
    </View>
  );
}

function PinnedCell({ tabId, geometry, from }: { tabId: string; geometry: DragGeometry; from: number }) {
  const windowId = useWindowId();
  const tab = useTab(tabId);
  const active = useIsActiveTab(tabId);
  const { hovered, hoverProps } = useHover();
  const strip = useContext(DockContext);
  const latestStrip = useRef(strip);
  latestStrip.current = strip;
  const dock = strip?.dock;
  const top = strip?.top;
  const end = top && top.slots.length ? top.lefts.at(-1)! + top.slots.at(-1)!.width : MAX_CHIP;
  const range: [number, number] | undefined = dock ? [-geometry.lefts[from]!, end - dock.left - geometry.lefts[from]! - PINNED_CELL] : undefined;
  const drag = useStripDrag({
    tabId,
    ids: () => withSelection(tabId),
    pinned: true,
    groupId: null,
    geometry,
    from,
    width: PINNED_CELL,
    gap: PINNED_SPACING,
    range,
    cross: dock ? pinOut(() => latestStrip.current, from) : undefined,
    levels: 2,
  });
  if (!tab) return null;
  return (
    <Animated.View ref={drag.ref} {...drag.panHandlers} mouseDownCanMoveWindow={false} style={drag.style}>
      <View {...hoverProps} style={{ opacity: drag.crossed ? 0 : 1 }} tooltip={`${tab.customTitle || tab.title || tab.url}${tab.url ? `\n${tab.url}` : ""}`}>
        <ContextMenuArea onContextMenu={() => void openTabMenu(windowId, tab)}>
          <Pressable onPress={(e) => clickTab(windowId, tab.id, modifiersOf(e))}>
            {({ pressed }) => <PinnedFace tabId={tabId} active={active} hovered={hovered} pressed={pressed} />}
          </Pressable>
        </ContextMenuArea>
      </View>
      {drag.crossed && strip && (
        <FadeIn style={{ left: 0, top: -(ITEM_TOP + 0.5), width: strip.chip, height: TOP_STRIP_HEIGHT }}>
          <TabChip tabId={tabId} width={strip.chip} dragged />
        </FadeIn>
      )}
    </Animated.View>
  );
}

function FolderCell({ folderId, tabIds, geometry, from }: { folderId: string; tabIds: string[]; geometry: DragGeometry; from: number }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const label = useBrowser((s) => folderLabel(folderIn(s, windowId, folderId)));
  const { hovered, hoverProps } = useHover();
  const drag = useStripDrag({
    tabId: null,
    ids: () => tabIds,
    pinned: true,
    groupId: null,
    geometry,
    from,
    width: PINNED_CELL,
    gap: PINNED_SPACING,
    levels: 2,
    local: true,
    drop: (dx, ids) => reorder(ids, { tabId: null, ids: () => ids, pinned: true, groupId: null, geometry, from, width: PINNED_CELL, gap: PINNED_SPACING }, dropIndex(geometry, from, dx)),
  });
  return (
    <Animated.View ref={drag.ref} {...drag.panHandlers} mouseDownCanMoveWindow={false} style={drag.style}>
      <View {...hoverProps} tooltip={`${label}\nShow Folder`}>
        <ContextMenuArea onContextMenu={() => void openTileFolderMenu(windowId, folderId)}>
          <Pressable onPress={() => void openTileFolderStripMenu(windowId, folderId)}>
            {({ pressed }) => (
              <View style={{ width: PINNED_CELL, height: ITEM_HEIGHT - 1, alignItems: "center", justifyContent: "center" }}>
                {(hovered || pressed) && (
                  <View style={{ position: "absolute", left: 2, right: 2, top: 2, bottom: 2, borderRadius: 8, backgroundColor: pressed ? theme.tabPressed : theme.tabHover }} />
                )}
                <View pointerEvents="none">
                  <FolderMosaic tabIds={tabIds} />
                </View>
              </View>
            )}
          </Pressable>
        </ContextMenuArea>
      </View>
    </Animated.View>
  );
}

function StripGroup({
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
  entry: GroupEntry;
  geometry: DragGeometry;
  from: number;
  chip: number;
  activeId: string;
  chipWidth: number | undefined;
  onChipWidth: (width: number) => void;
  memberWidth: (m: Member) => number;
  folderMeasured: (groupId: string) => boolean;
}) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const windowId = useWindowId();
  const profileId = usePageProfileId();
  const group = useBrowser((s) => s.groups[entry.id]);
  const onto = useOnto({ kind: "group", id: entry.id });
  const { hovered, hoverProps } = useHover();
  const expanded = !entry.collapsed;
  const widths = entry.members.map(memberWidth);
  const shown = entry.members.findIndex((m) => holds(m, activeId));
  const chipSize = chipWidth ?? 0;
  const { offsets, width } = groupLayout(chipSize, widths, GAP, expanded, shown);
  const members = useMemo(() => dragGeometry(entry.members.map((m, i) => ({ tabIds: tabsOf(m), width: widths[i]! })), GAP), [entry.members, widths.join()]);
  const tuckable = useBrowser((s) => !expanded && shown >= 0 && !!tuckTarget(s, windowId, profileId, entry.id));
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
    ids: () => useBrowser.getState().groups[entry.id]?.tabIds ?? [],
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
      const s = useBrowser.getState();
      s.moveGroup(entry.id, { pinned: !!s.groups[entry.id]?.pinned, beforeId: others[to]?.tabIds[0] ?? null });
      return true;
    },
  });
  const tail = useMemo(() => Animated.add(size, -(TAIL_EXPANDED - 2.25)), []);
  if (!group) return null;
  const tint = group.color ? GROUP_COLORS[group.color].hex : null;
  const divider = theme.dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.12)";
  const tuck = () => {
    const s = useBrowser.getState();
    const target = tuckTarget(s, windowId, profileId, entry.id);
    if (target) s.activate(target);
  };
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
          borderWidth: 0.5,
          borderColor: theme.pinnedRestingStroke,
          backgroundColor: tint ? withAlpha(tint, hovered ? 0.24 : 0.18) : hovered ? tokens.groupHeaderHover : tokens.groupFill,
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
        <IconButton icon="xmark" size={9} weight="semibold" box={24} radius={6} style={{ marginLeft: 1 }} onPress={() => useBrowser.getState().closeGroup(entry.id)} tooltip="Close Group" />
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
            onPress={() => useBrowser.getState().updateGroup(entry.id, { collapsed: expanded })}
            style={{ height: ITEM_HEIGHT, flexDirection: "row", alignItems: "center", paddingLeft: 8.5, paddingRight: 7 }}
          >
            {group.icon ? <Text style={{ width: 13, fontSize: 12, textAlign: "center" }}>{group.icon}</Text> : <GroupGlyph color={tint ?? (theme.dark ? NEUTRAL_GROUP_SWATCH.dark : NEUTRAL_GROUP_SWATCH.light)} />}
            <Text numberOfLines={1} style={{ marginLeft: 12.5, maxWidth: 120, fontSize: 12, fontWeight: "600", color: tint ?? (shown >= 0 ? theme.tabSelectedText : theme.textTab) }}>
              {group.name || `${group.tabIds.length} Tabs`}
            </Text>
          </Pressable>
        </ContextMenuArea>
      </View>
    </Animated.View>
  );
}

function GroupMember({
  member,
  width,
  start,
  offset,
  open,
  interactive,
  shown,
  geometry,
  from,
  chip,
  activeId,
  measured,
  tuck,
  out,
}: {
  member: Member;
  width: number;
  start: number;
  offset: number;
  open: Animated.Value;
  interactive: boolean;
  shown: boolean;
  geometry: DragGeometry;
  from: number;
  chip: number;
  activeId: string;
  measured: boolean;
  tuck?: () => void;
  out: GroupOut;
}) {
  const shownValue = useRef(new Animated.Value(shown ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(shownValue, { toValue: shown ? 1 : 0, duration: TUCK_FADE_MS, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [shown]);
  const left = useMemo(() => open.interpolate({ inputRange: [0, 1], outputRange: [start, start + offset] }), [start, offset]);
  const opacity = useMemo(
    () =>
      Animated.add(shownValue, open.interpolate({ inputRange: [0, 0.5], outputRange: [0, 1], extrapolate: "clamp" })).interpolate({
        inputRange: [0, 1],
        outputRange: [0, 1],
        extrapolate: "clamp",
      }),
    [],
  );
  return (
    <Animated.View pointerEvents={interactive ? "box-none" : "none"} style={{ position: "absolute", top: 0, left, width, height: TOP_STRIP_HEIGHT, opacity: measured ? opacity : 0, zIndex: shown ? 2 : 1 }}>
      {member.kind === "folder" ? (
        <FolderMember groupId={member.id} chip={chip} shownTab={member.tabIds.includes(activeId) ? activeId : null} tuck={tuck} />
      ) : member.kind === "split" ? (
        <SplitChip tabIds={member.tabIds} width={width} geometry={geometry} from={from} group={member.group} />
      ) : (
        <DraggableChip tabId={member.id} width={width} geometry={geometry} from={from} group={member.group} tuck={tuck} out={out} />
      )}
    </Animated.View>
  );
}

function FolderMember({ groupId, chip, shownTab, tuck }: { groupId: string; chip: number; shownTab: string | null; tuck?: () => void }) {
  const width = useMeasuredWidth(folderKey(groupId)) ?? 0;
  return (
    <View pointerEvents="box-none" style={{ height: TOP_STRIP_HEIGHT }}>
      <FolderChip groupId={groupId} holding={!!shownTab} />
      {shownTab && (
        <View style={{ position: "absolute", top: 0, left: width + MEMBERS_INSET }}>
          <TabChip tabId={shownTab} width={chip} tuck={tuck} dragged={false} />
        </View>
      )}
    </View>
  );
}

function FolderChip({ groupId, holding }: { groupId: string; holding: boolean }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const windowId = useWindowId();
  const group = useBrowser((s) => s.groups[groupId]);
  const label = useBrowser((s) => (s.groups[groupId] ? groupLabel(s, s.groups[groupId]!) : ""));
  const { hovered, hoverProps } = useHover();
  if (!group) return null;
  const tint = group.color ? GROUP_COLORS[group.color].hex : null;
  const ink = tint ?? (holding ? theme.tabSelectedText : theme.textTab);
  return (
    <View
      {...hoverProps}
      mouseDownCanMoveWindow={false}
      tooltip={`${label}\nShow Folder`}
      onLayout={(e) => setMeasuredWidth(folderKey(groupId), Math.ceil(e.nativeEvent.layout.width * 2) / 2)}
      style={{ position: "absolute", left: 0, top: MID - FOLDER_HEIGHT / 2, height: FOLDER_HEIGHT }}
    >
      <ContextMenuArea onContextMenu={() => void openGroupMenu(windowId, groupId)}>
        <Pressable onPress={() => void openFolderMenu(windowId, groupId)}>
          {({ pressed }) => (
            <View
              style={{
                height: FOLDER_HEIGHT,
                flexDirection: "row",
                alignItems: "center",
                paddingLeft: 7,
                paddingRight: 6,
                borderRadius: FOLDER_RADIUS,
                borderWidth: 0.5,
                borderColor: theme.pinnedRestingStroke,
                backgroundColor: pressed ? theme.tabPressed : tint ? withAlpha(tint, hovered ? 0.3 : 0.22) : hovered ? tokens.groupHeaderHover : tokens.groupFill,
              }}
            >
              {group.icon ? <Text style={{ width: 13, fontSize: 12, textAlign: "center" }}>{group.icon}</Text> : <GroupGlyph color={tint ?? (theme.dark ? NEUTRAL_GROUP_SWATCH.dark : NEUTRAL_GROUP_SWATCH.light)} />}
              <Text numberOfLines={1} style={{ marginLeft: 7, maxWidth: 110, fontSize: 12, fontWeight: "600", color: ink }}>
                {label}
              </Text>
              <Symbol name="chevron.down" size={8} weight="semibold" color={withAlpha(ink, 0.6)} style={{ marginLeft: 5, width: 9, height: 9 }} />
            </View>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}

function GroupGlyph({ color }: { color: string }) {
  return (
    <View style={{ width: 13, height: 11, flexDirection: "row", alignItems: "center" }}>
      <View style={{ width: 1.25, height: 7, borderRadius: 0.625, backgroundColor: color, opacity: 0.5 }} />
      <View style={{ width: 1.25, height: 9, borderRadius: 0.625, marginLeft: 0.6, backgroundColor: color, opacity: 0.75 }} />
      <View style={{ width: 9.4, height: 10.6, borderRadius: 2.5, marginLeft: 0.5, backgroundColor: color }} />
    </View>
  );
}

function SplitChip({ tabIds, width, geometry, from, group }: { tabIds: string[]; width: number; geometry: DragGeometry; from: number; group: string | null }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const profileId = usePageProfileId();
  const focusedId = useBrowser((s) => s.windows[windowId]?.activeTabIds[profileId] ?? "");
  const active = tabIds.includes(focusedId);
  const { band, palette } = useWebsiteBand(active ? focusedId : tabIds[0]!);
  const floating = useContext(FloatingStrip);
  const ink = active && !floating && palette.background ? palette : null;
  const { hovered, hoverProps } = useHover();
  const drag = useStripDrag({ tabId: null, ids: () => tabIds, pinned: false, groupId: group, geometry, from, width, gap: GAP, axis: "x" });
  return (
    <Animated.View ref={drag.ref} {...drag.panHandlers} mouseDownCanMoveWindow={false} style={{ ...drag.style, zIndex: drag.dragging ? 10 : active ? 1 : 0 }}>
      <View {...hoverProps} style={{ width, height: TOP_STRIP_HEIGHT }}>
        {active && <SelectedTab width={width} band={band} opaque={drag.dragging} />}
        <ItemRow hovered={hovered && !active} pressed={false}>
          <Symbol name="rectangle.split.2x1" size={11} color={ink?.secondary ?? theme.textSecondary} style={{ width: 14, height: 16, marginRight: 4 }} />
          {tabIds.map((id, i) => (
            <SplitPart key={id} tabId={id} first={i === 0} ink={ink} />
          ))}
        </ItemRow>
      </View>
    </Animated.View>
  );
}

const NO_SLOTS = dragGeometry([], GAP);

function SplitPart({ tabId, first, ink }: { tabId: string; first: boolean; ink: ToolbarPalette | null }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const tab = useTab(tabId);
  const focused = useIsActiveTab(tabId);
  const drag = useStripDrag({ tabId, ids: () => [tabId], pinned: false, groupId: null, geometry: NO_SLOTS, from: -1, width: 0, gap: 0, axis: "y" });
  if (!tab) return null;
  return (
    <Animated.View ref={drag.ref} {...drag.panHandlers} style={{ flex: 1, flexDirection: "row", alignItems: "center", opacity: drag.style.opacity }}>
      <ContextMenuArea onContextMenu={() => void openTabMenu(windowId, tab)} style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
        {!first && <View style={{ width: StyleSheet.hairlineWidth, height: 16, marginHorizontal: 6, backgroundColor: ink?.divider ?? theme.textTertiary }} />}
        <Pressable onPress={() => useBrowser.getState().activate(tab.id)} style={{ flex: 1, flexDirection: "row", alignItems: "center" }} tooltip={tab.title || tab.url}>
          <View pointerEvents="none">
            <TabIcon url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={14} profileId={tab.profileId} />
          </View>
          <FadeLabel text={tab.customTitle || tab.title || tab.url || "New Tab"} fontSize={12} color={ink ? (focused ? ink.text : ink.secondary) : focused ? theme.tabSelectedText : theme.textTab} style={{ flex: 1, height: 16, marginLeft: 5 }} />
        </Pressable>
      </ContextMenuArea>
    </Animated.View>
  );
}

function NewTabButton({ windowId, geometry }: { windowId: string; geometry: DragGeometry }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const shift = useRef(new Animated.Value(0)).current;
  const latest = useRef(geometry);
  latest.current = geometry;
  useEffect(() => registerSlot(() => latest.current, () => latest.current.slots.length, shift), []);
  return (
    <Animated.View {...hoverProps} mouseDownCanMoveWindow={false} tooltip="New Tab (⌘T) — ⌥-click to open in Split View" style={{ marginTop: ITEM_TOP, marginLeft: 0.5, transform: [{ translateX: shift }] }}>
      <Pressable
        onPress={(e) => {
          if (modifiersOf(e).altKey) openNewTabInSplit(windowId);
          else toggleNewTabBar(windowId) || useBrowser.getState().newTab(windowId);
        }}
      >
        {({ pressed }) => (
          <View style={{ width: ITEM_HEIGHT, height: ITEM_HEIGHT, borderRadius: TAB_RADIUS, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? theme.tabPressed : hovered ? theme.tabHover : undefined }}>
            <Symbol name="plus" size={13} color={theme.textSecondary} style={{ width: 16, height: 16 }} />
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const HOVER_HEIGHT = 6;
const PEEK_LEFT = 6;
const PEEK_TOP = 4;

export function TopStripPeek({ windowWidth, enabled }: { windowWidth: number; enabled: boolean }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const { slide, live, show, hide } = usePeek(enabled);
  useEffect(() => {
    if (!enabled) return;
    void setTrafficLightsCenter(windowId, lightsCenter(layout.sidebarWidth));
    return () => void setTrafficLightsCenter(windowId, null);
  }, [enabled, windowId]);
  const leaveStrip = (e: { nativeEvent: { clientY: number } }) => {
    if (live && e.nativeEvent.clientY < HOVER_HEIGHT) hide();
  };
  const leavePanel = (e: { nativeEvent: { clientX: number; clientY: number } }) => {
    const x = e.nativeEvent.clientX + PEEK_LEFT;
    const y = e.nativeEvent.clientY + PEEK_TOP;
    if (!(y >= 0 && y < HOVER_HEIGHT && x >= layout.trafficLightsWidth)) hide();
  };
  return (
    <>
      {enabled ? (
        <View
          onMouseEnter={show}
          onMouseLeave={leaveStrip}
          style={{ position: "absolute", left: layout.trafficLightsWidth, right: PEEK_LEFT, top: 0, height: HOVER_HEIGHT }}
        />
      ) : null}
      <Animated.View
        pointerEvents={live ? "auto" : "none"}
        onMouseEnter={live ? show : undefined}
        onMouseLeave={live ? leavePanel : undefined}
        style={{
          position: "absolute",
          left: PEEK_LEFT,
          width: windowWidth - PEEK_LEFT * 2,
          top: live ? PEEK_TOP : -10_000,
          height: PEEK_HEIGHT,
          opacity: slide,
          transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-PEEK_HEIGHT - 8, 0] }) }],
        }}
      >
        <Surface
          fill={hex(theme.windowTint[0])}
          cornerRadius={12}
          borderColor={hex(theme.panelBorder)}
          borderWidth={PEEK_BORDER}
          shadowColor="#000000"
          shadowOpacity={theme.panelShadowOpacity}
          shadowRadius={20}
          shadowOffset={[0, 6]}
          style={{ flex: 1 }}
        >
          <View style={{ position: "absolute", left: 0, right: 0, top: PEEK_PAD - ITEM_TOP, height: TOP_STRIP_HEIGHT }}>
            <TopTabStrip floating swipe={live} width={windowWidth - 12 - PEEK_BORDER * 2} />
          </View>
        </Surface>
      </Animated.View>
    </>
  );
}
