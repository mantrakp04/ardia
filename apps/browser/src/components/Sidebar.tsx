import { ContextMenuArea, FadeLabel, Symbol, WindowDragRegion } from "@ardia/shell";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { switchOn } from "../lib/killSwitches";
import { live } from "../live/store";
import { everySlowly } from "../lib/slowTimers";
import { layout, ThemeScope, useTheme } from "../lib/theme";
import { useBrowser } from "../store/browser";
import { PageProfileContext, useSettings, useWindowId, useWindowProfileId } from "../store/hooks";
import { activeTabId } from "../store/model";
import { downloadsIn } from "../store/ui";
import { ancestorIds } from "../store/groups";
import { cleanedTabsFor, cleanUpCandidates, groupOf } from "../store/organize";
import { splitOf } from "../store/splits";
import { openNewTabInSplit } from "./layout/splitActions";
import { listTopGap, SIDEBAR_FIELD, SIDEBAR_FOOTER_DOWNLOADS, SIDEBAR_HEADER_WITH_FIELD, useAddressBarInSidebar } from "./layout/windowLayout";
import { SIDEBAR_PLAYER_HEIGHT, SidebarPlayer, useSidebarPlayerTab } from "./media/SidebarPlayer";
import { HoverSlot } from "./HoverSlot";
import { IconButton, useHover } from "./primitives";
import { PROFILE_INDICATOR_X, ProfileIndicator } from "./ProfileIndicator";
import { usePageStyle, usePagerPages } from "./layout/profilePager";
import { PROFILE_DOTS_HEIGHT, ProfileDots, useProfileDotsShown } from "./profiles/ProfileDots";
import { SidebarAddressRow, SidebarHeaderTools } from "./sidebar/AddressBar";
import { ClearDivider } from "./sidebar/ClearDivider";
import { canTidyPins } from "../store/tidyPins";
import { DragGhost } from "./sidebar/DragGhost";
import { DragProvider, DragScope, useDragController, useDragging, useDragItem, usePinnedCount, type Ghost } from "./sidebar/dnd";
import { SidebarDropArea } from "./sidebar/fileDrop";
import { useClipped, useShift, type ClipSource, type EntryMotion } from "./sidebar/entryMotion";
import { sidebarEntries } from "./sidebar/entries";
import { FolderPanel } from "./sidebar/FolderPanel";
import { GroupBlock } from "./sidebar/GroupBlock";
import { dismissHover, dismissHoverIn } from "./sidebar/hover";
import { capture, GhostSlot, ListMotionContext, newCapture, useListMotion } from "./sidebar/listMotion";
import { LiveFolderBlock } from "./sidebar/LiveFolderBlock";
import { openOverflowMenu, openSidebarMenu } from "./sidebar/menus";
import { PinFieldZone, PinnedGrid, PinSlotZone } from "./sidebar/PinnedGrid";
import { LIVE, usePinnedSequence } from "./sidebar/pinnedOrder";
import { pinGridHeight } from "./sidebar/pinZone";
import { ResizeHandle } from "./sidebar/ResizeHandle";
import { SCROLL_EDGE, ScrollEdgeLine, useScrollEdge } from "./sidebar/ScrollEdge";
import { entriesHeight, firstPaintEntries, rowSpan, startsOffScreen, type Section } from "./sidebar/geometry";
import { measureRow } from "./sidebar/state";
import { SplitRowItem, TabRowItem } from "./sidebar/TabRow";
import { closeFolderPanel } from "./sidebar/tileFolderUi";
import { useSidebarTokens } from "./sidebar/tokens";
import { toggleNewTabBar } from "./omnibox/newTabBar";

const GLOW_ROOM = 24;
const ROW_PITCH = layout.rowHeight + layout.rowGap;
const DOCKED_BOTTOM = 6;
const DOCK = DOCKED_BOTTOM + ROW_PITCH;
const ROWS_PER_FRAME = 32;
const DOCK_SHARE = 0.4;
const NONE: string[] = [];

export function Sidebar({ width }: { width: number }) {
  const windowId = useWindowId();
  const current = useWindowProfileId();
  const { pages, paging } = usePagerPages(windowId);
  const [available, setAvailable] = useState(0);
  const listHeight = useRef(0);
  const [, setDockChanges] = useState(0);
  const dockedAt = (list: number) => available > 0 && list + ROW_PITCH + 12 > available;
  const docked = dockedAt(listHeight.current);
  const onListHeight = (height: number) => {
    const before = dockedAt(listHeight.current);
    listHeight.current = height;
    if (dockedAt(height) !== before) setDockChanges((n) => n + 1);
  };
  const scroll = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const geometry = useRef<SidebarGeometry>({ viewport: 0, regions: { pinnedGroups: 0, list: 0 }, newTabAtTop: false, room: 0, pad: 0, tilesFixed: true });
  const playerTab = useSidebarPlayerTab(windowId);
  const playerHeight = playerTab ? SIDEBAR_PLAYER_HEIGHT : 0;
  const addressBar = useAddressBarInSidebar();
  const header = addressBar ? SIDEBAR_HEADER_WITH_FIELD : layout.sidebarHeader;
  const glowRoom = addressBar ? 0 : GLOW_ROOM;
  const hasDownloads = useBrowser((s) => downloadsIn(s, windowId).length > 0);
  const dots = useProfileDotsShown();
  const footerDownloads = addressBar && hasDownloads;
  const footer = dots || footerDownloads ? PROFILE_DOTS_HEIGHT : 0;
  const nothingPinned = useBrowser((s) => sidebarEntries(s, windowId, current).tiles.length === 0);

  useRevealTabs(windowId, scroll, scrollY, geometry);
  useLayoutEffect(() => dismissHoverIn(windowId), [windowId, current, paging]);

  return (
    <DragProvider>
      {(ghost: Ghost | null, controller) => (
        <SidebarDropArea
          ref={(v) => {
            controller.root = v;
          }}
          style={{ width, height: "100%" }}
        >
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: header - glowRoom,
              bottom: (docked ? DOCK : 0) + playerHeight + footer,
              overflow: paging ? "hidden" : "visible",
            }}
            onLayout={(e) => setAvailable(e.nativeEvent.layout.height + (docked ? DOCK : 0))}
          >
            {pages.map((page) => (
              <SidebarPage
                key={page.id}
                profileId={page.id}
                slot={page.slot}
                width={width}
                current={page.id === current}
                resting={!!page.resting}
                docked={docked}
                glowRoom={glowRoom}
                height={available}
                rows={page.id === current ? undefined : Math.ceil(available / ROW_PITCH) + 1}
                geometry={page.id === current ? geometry : undefined}
                onListHeight={onListHeight}
                onScrollView={(v) => {
                  scroll.current = v;
                  controller.scroll = v;
                }}
                onScrollY={(y) => {
                  scrollY.current = y;
                  controller.scrollY = y;
                  dismissHover();
                  closeFolderPanel();
                }}
              />
            ))}
          </View>

          {playerTab ? (
            <View style={{ position: "absolute", left: layout.sidebarInset, right: layout.sidebarInset, bottom: (docked ? DOCK : 8) + footer }}>
              <SidebarPlayer tabId={playerTab} />
            </View>
          ) : null}

          {docked ? (
            <View style={{ position: "absolute", left: layout.sidebarInset, right: layout.sidebarInset, bottom: DOCKED_BOTTOM + footer }}>
              <NewTabRow windowId={windowId} />
            </View>
          ) : null}

          {footer ? (
            <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: footer }}>
              {dots ? <ProfileDots windowId={windowId} /> : null}
              {footerDownloads ? (
                <View style={{ position: "absolute", left: layout.sidebarInset, bottom: SIDEBAR_FOOTER_DOWNLOADS.bottom }}>
                  <DownloadsButton windowId={windowId} />
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={{ height: header }}>
            <WindowDragRegion style={StyleSheet.absoluteFill} />
            {addressBar ? (
              <>
                <SidebarHeaderTools width={width} />
                <SidebarAddressRow width={width} />
              </>
            ) : (
              <View pointerEvents="box-none" style={{ height: layout.sidebarHeader, flexDirection: "row", alignItems: "flex-start", paddingLeft: PROFILE_INDICATOR_X, paddingRight: 7, paddingTop: 27 - 17 }}>
                <ProfileIndicator room={width - PROFILE_INDICATOR_X - 7 - (hasDownloads ? 34 + 2 : 0)} />
                <View pointerEvents="none" style={{ flex: 1 }} />
                {hasDownloads ? <DownloadsButton windowId={windowId} /> : null}
              </View>
            )}
          </View>

          <ResizeHandle windowId={windowId} />
          {ghost && !ghost.landing && nothingPinned ? (
            addressBar ? (
              <PinFieldZone top={SIDEBAR_FIELD.top} height={SIDEBAR_FIELD.height} />
            ) : (
              <PinSlotZone />
            )
          ) : null}
          <FolderPanel windowId={windowId} />
          {ghost ? <DragGhost ghost={ghost} /> : null}
        </SidebarDropArea>
      )}
    </DragProvider>
  );
}

type PageProps = {
  profileId: string;
  slot: number;
  width: number;
  current: boolean;
  resting: boolean;
  docked: boolean;
  glowRoom: number;
  height: number;
  rows: number | undefined;
  geometry: RefObject<SidebarGeometry> | undefined;
  onListHeight: (height: number) => void;
  onScrollView: (view: ScrollView | null) => void;
  onScrollY: (y: number) => void;
};

function SidebarPage({ profileId, slot, width, current, resting, docked, glowRoom, height, rows, geometry, onListHeight, onScrollView, onScrollY }: PageProps) {
  const windowId = useWindowId();
  const topGap = listTopGap(useAddressBarInSidebar());
  const pageStyle = usePageStyle(windowId, slot, width);
  const [lazy] = useState(() => switchOn("lazySidebarRows"));
  const [beside, setBeside] = useState(() => startsOffScreen(lazy, current));
  useEffect(() => {
    if (!beside) return;
    const frame = requestAnimationFrame(() => setBeside(false));
    return () => cancelAnimationFrame(frame);
  }, [beside]);
  const offScreen = beside && !current;
  const tiles = useBrowser((s) => (offScreen ? NONE : sidebarEntries(s, windowId, profileId).cells));
  const innerWidth = width - layout.sidebarInset * 2;
  const dragging = useDragging() && current;
  const previewed = usePinnedCount(tiles);
  const dockRoom = height ? height * DOCK_SHARE - topGap - SCROLL_EDGE.gap - SCROLL_EDGE.line : Infinity;
  const balanced = useBrowser((s) => s.settings.balancedTopApps);
  const gridHeight = (count: number) => pinGridHeight(count, innerWidth, layout.pinnedHeight, balanced);
  const placedFixed = useRef(true);
  if (!dragging) placedFixed.current = !tiles.length || gridHeight(tiles.length) <= dockRoom;
  const dockFixed = placedFixed.current;
  const capped = dockFixed && dragging && gridHeight(previewed) > dockRoom;
  const fixedTiles = dockFixed ? tiles : NONE;
  const scrolledTiles = dockFixed ? NONE : tiles;
  const room = fixedTiles.length ? 0 : glowRoom;
  const pad = room + SCROLL_EDGE.inset;
  if (geometry) {
    geometry.current.room = room;
    geometry.current.pad = pad;
    geometry.current.tilesFixed = dockFixed;
  }
  const scrollEdge = useScrollEdge();
  const scrollY = useRef(new Animated.Value(0)).current;
  const isCurrent = useRef(current);
  isCurrent.current = current;
  const [onScroll] = useState(() =>
    Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
      useNativeDriver: true,
      listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        scrollEdge.follow(e.nativeEvent.contentOffset.y);
        if (isCurrent.current) onScrollY(e.nativeEvent.contentOffset.y);
      },
    }),
  );
  const edge = useMemo(() => scrollY.interpolate({ inputRange: [0, 1], outputRange: [0, room], extrapolate: "clamp" }), [scrollY, room]);
  const fixed = useRef({ height: 0, list: 0 });
  const reportList = (list: number) => {
    fixed.current.list = list;
    onListHeight(fixed.current.height + list);
  };
  const onFixedLayout = (e: LayoutChangeEvent) => {
    fixed.current.height = e.nativeEvent.layout.height;
    if (current && fixed.current.list) onListHeight(fixed.current.height + fixed.current.list);
  };
  const inlineNewTab = !current || !docked;

  return (
    <Animated.View
      pointerEvents={current ? "auto" : "none"}
      style={{ position: "absolute", top: 0, bottom: 0, left: 0, width, display: resting ? "none" : "flex", ...pageStyle }}
    >
      <PageProfileContext.Provider value={profileId}>
        <ThemeScope>
          <DragScope enabled={current}>
            <PageContent>
              {(controller) => (
                <TilesPlacement controller={controller} fixed={dockFixed} room={dockRoom}>
                  <View onLayout={onFixedLayout} style={{ paddingTop: glowRoom }}>
                    <View style={[{ paddingHorizontal: layout.sidebarInset }, capped ? { maxHeight: topGap + dockRoom, overflow: "hidden" } : null]}>
                      {dockFixed ? <PinnedGrid tabs={fixedTiles} innerWidth={innerWidth} /> : null}
                    </View>
                    <View style={{ height: fixedTiles.length ? SCROLL_EDGE.gap : topGap - SCROLL_EDGE.inset - SCROLL_EDGE.line }} />
                    <ScrollEdgeLine opacity={scrollEdge.opacity} />
                  </View>
                  <Animated.View style={{ flex: 1, marginTop: -room, overflow: "hidden", transform: [{ translateY: edge }] }}>
                    <Animated.View style={{ flex: 1, transform: [{ translateY: Animated.multiply(edge, -1) }] }}>
                      <Animated.ScrollView
                        ref={current ? onScrollView : undefined}
                        onLayout={
                          geometry
                            ? (e) => {
                                geometry.current.viewport = e.nativeEvent.layout.height;
                                geometry.current.laidOut?.();
                              }
                            : undefined
                        }
                        style={{ flex: 1 }}
                        showsVerticalScrollIndicator={false}
                        scrollEventThrottle={16}
                        onScroll={onScroll}
                        contentContainerStyle={{ flexGrow: 1, width, paddingHorizontal: layout.sidebarInset, paddingTop: pad }}
                      >
                        <PageRows
                          windowId={windowId}
                          profileId={profileId}
                          current={current}
                          rows={rows}
                          lazy={lazy}
                          offScreen={offScreen}
                          tiles={scrolledTiles}
                          innerWidth={innerWidth}
                          inlineNewTab={inlineNewTab}
                          controller={controller}
                          geometry={geometry}
                          onListHeight={reportList}
                        />
                        <ContextMenuArea style={{ flexGrow: 1, minHeight: inlineNewTab ? 24 : 0 }} onContextMenu={() => void openSidebarMenu(windowId)}>
                          <WindowDragRegion style={{ flex: 1 }} titleBarDoubleClick={false} onRegionDoubleClick={() => toggleNewTabBar(windowId) || useBrowser.getState().newTab(windowId)} />
                        </ContextMenuArea>
                      </Animated.ScrollView>
                    </Animated.View>
                  </Animated.View>
                </TilesPlacement>
              )}
            </PageContent>
          </DragScope>
        </ThemeScope>
      </PageProfileContext.Provider>
    </Animated.View>
  );
}

type PageRowsProps = {
  windowId: string;
  profileId: string;
  current: boolean;
  rows: number | undefined;
  lazy: boolean;
  offScreen: boolean;
  tiles: string[];
  innerWidth: number;
  inlineNewTab: boolean;
  controller: ReturnType<typeof useDragController>;
  geometry: RefObject<SidebarGeometry> | undefined;
  onListHeight: (height: number) => void;
};

function PageRows({ windowId, profileId, current, rows, lazy, offScreen, tiles, innerWidth, inlineNewTab, controller, geometry, onListHeight }: PageRowsProps) {
  const [captured] = useState(newCapture);
  const { list: all } = useBrowser((s) => {
    const entries = sidebarEntries(s, windowId, profileId);
    return capture(captured, s, entries.list, entries);
  });
  const [mountedRows, setMountedRows] = useState(() => firstPaintEntries(useBrowser.getState(), windowId, profileId, all, lazy));
  const [visited, setVisited] = useState(current);
  if (current && !visited) setVisited(true);
  const cap = offScreen ? 0 : visited ? undefined : rows;
  const growing = cap === undefined && mountedRows < all.length;
  useEffect(() => {
    if (!growing) return;
    const frame = requestAnimationFrame(() => setMountedRows((n) => (n + ROWS_PER_FRAME >= all.length ? Infinity : n + ROWS_PER_FRAME)));
    return () => cancelAnimationFrame(frame);
  }, [growing, mountedRows, all.length]);
  const limit = cap ?? (growing ? mountedRows : undefined);
  const list = limit === undefined ? all : all.slice(0, limit);
  const pending = useBrowser((s) => (growing ? entriesHeight(s, windowId, profileId, all.slice(mountedRows)) : 0));
  const clearable = !offScreen && all.length > 0;
  const tidy = useBrowser((s) => !offScreen && canTidyPins(s, windowId, profileId));
  const divided = clearable || tidy;
  const pinned = usePinnedSequence(windowId, profileId, offScreen);
  const pinnedSection = pinned.length > 0;
  const newTabsAtTop = useSettings((s) => s.newTabPosition === "top");
  const animated = current && !offScreen;
  const motion = useListMotion(windowId, profileId, all, captured, animated);
  const scope = useMemo(() => ({ enabled: animated, slideBelow: motion.slideBelow }), [animated, motion.slideBelow]);
  if (geometry) geometry.current.newTabAtTop = newTabsAtTop && inlineNewTab;
  const measured = useRef(0);
  useEffect(() => {
    if (current && measured.current) onListHeight(measured.current);
  }, [current]);

  return (
    <ListMotionContext.Provider value={scope}>
      <View
        onLayout={(e) => {
          measured.current = e.nativeEvent.layout.height + SCROLL_EDGE.inset - (inlineNewTab ? ROW_PITCH : 0);
          if (current) onListHeight(measured.current);
        }}
      >
        {tiles.length ? <PinnedGrid tabs={tiles} innerWidth={innerWidth} flush /> : null}
        <View
          ref={(v) => {
            controller?.regions.set("pinnedGroups", v);
          }}
          onLayout={geometry ? (e) => void (geometry.current.regions.pinnedGroups = e.nativeEvent.layout.y) : undefined}
          style={{ marginTop: tiles.length ? 6 : 0, gap: layout.rowGap }}
        >
          {pinned.map((entry) => (
            <PinnedEntry key={entry} entry={entry} windowId={windowId} />
          ))}
          <Tail id="tail:pinnedGroups" section="pinnedGroups" />
        </View>
        {divided ? <ClearDivider windowId={windowId} profileId={profileId} spaced={pinnedSection} clear={clearable} tidy={tidy} /> : null}
        <View
          ref={(v) => {
            controller?.regions.set("list", v);
          }}
          onLayout={geometry ? (e) => void (geometry.current.regions.list = e.nativeEvent.layout.y) : undefined}
          style={{ marginTop: pinnedSection && !divided ? 7 : 0, gap: layout.rowGap }}
        >
          {newTabsAtTop && inlineNewTab ? <NewTabRow windowId={windowId} /> : null}
          {motion.fading
            ? motion.slots(list).map((slot) =>
                "ghost" in slot ? (
                  <GhostSlot key={slot.ghost.key} snapshot={slot.ghost.snapshot} top={slot.top} opacity={slot.ghost.opacity} />
                ) : (
                  <ListEntry key={slot.entry} entry={slot.entry} motion={motion.motion(slot.entry)} />
                ),
              )
            : list.map((entry) => <ListEntry key={entry} entry={entry} motion={motion.motion(entry)} />)}
          {pending ? <View style={{ height: pending }} /> : null}
          <Tail id="tail:list" section="list" />
          {!newTabsAtTop && inlineNewTab ? <NewTabRow windowId={windowId} shift={motion.tail} clip={motion.tailClip} /> : null}
        </View>
        {current ? <CleanUpUpsell windowId={windowId} shift={motion.tail} /> : null}
      </View>
    </ListMotionContext.Provider>
  );
}

function TilesPlacement({ controller, fixed, room, children }: { controller: ReturnType<typeof useDragController>; fixed: boolean; room: number; children: ReactNode }) {
  if (controller) {
    controller.tilesFixed = fixed;
    controller.tilesRoom = room;
  }
  return <>{children}</>;
}

function PageContent({ children }: { children: (controller: ReturnType<typeof useDragController>) => ReactNode }) {
  return <>{children(useDragController())}</>;
}

const PinnedEntry = memo(function PinnedEntry({ entry, windowId }: { entry: string; windowId: string }) {
  const id = entry.slice(entry.indexOf(":") + 1);
  if (entry.startsWith(LIVE)) return <LiveFolderBlock folderId={id} windowId={windowId} />;
  if (entry.startsWith("g:")) return <GroupBlock groupId={id} section="pinnedGroups" />;
  if (entry.startsWith("s:")) return <SplitRowItem splitId={id} section="pinnedRows" />;
  return <TabRowItem tabId={id} section="pinnedRows" />;
});

const ListEntry = memo(function ListEntry({ entry, motion }: { entry: string; motion: EntryMotion | null }) {
  const id = entry.slice(2);
  if (entry.startsWith("g:")) return <GroupBlock groupId={id} section="list" motion={motion} />;
  if (entry.startsWith("s:")) return <SplitRowItem splitId={id} section="list" motion={motion} />;
  return <TabRowItem tabId={id} section="list" motion={motion} />;
});

const Tail = memo(function Tail({ id, section }: { id: string; section: "list" | "pinnedRows" | "pinnedGroups" }) {
  const { wrapper } = useDragItem(id, { kind: "tail", tabIds: [], section });
  return <Animated.View ref={wrapper.ref} style={wrapper.style} />;
});

type SidebarGeometry = { viewport: number; regions: Record<Section, number>; newTabAtTop: boolean; room: number; pad: number; tilesFixed: boolean; laidOut?: () => void };

function useRevealTabs(windowId: string, scroll: RefObject<ScrollView | null>, scrollY: RefObject<number>, geometry: RefObject<SidebarGeometry>) {
  useEffect(() => {
    let switched: string | null = null;
    let opened: string | null = null;
    let frame = 0;
    let reveals = 0;
    const show = (y: number, height: number) => {
      const top = scrollY.current ?? 0;
      const { viewport, room, pad } = geometry.current;
      if (y - top < room) scroll.current?.scrollTo({ y: Math.max(0, y - pad), animated: true });
      else if (y + height - top > viewport - 8) scroll.current?.scrollTo({ y: y + height - viewport + 8, animated: true });
    };
    const reveal = () => {
      frame = 0;
      if (!geometry.current.viewport || !scroll.current) return;
      const mine = ++reveals;
      const tabId = switched ?? opened;
      switched = opened = null;
      const s = useBrowser.getState();
      const profileId = s.windows[windowId]?.profileId;
      if (!tabId || !profileId) return;
      const pinned = s.tabs[tabId];
      if (geometry.current.tilesFixed && pinned?.pinned && !pinned.pinnedAsRow) return;
      const { regions, newTabAtTop } = geometry.current;
      const span = rowSpan(s, windowId, profileId, tabId, newTabAtTop);
      const pinnedHasLive = span?.section === "pinnedGroups" && live().folderOrder.some((id) => live().folders[id]?.profileId === profileId);
      if (span && !pinnedHasLive) return show(geometry.current.pad + regions[span.section] + span.top, span.height);
      const view = scroll.current as unknown as View;
      const split = splitOf(s, tabId);
      const inner = groupOf(s, tabId);
      const keys = [tabId, ...(split ? [`s:${split.id}`] : []), ...(inner ? [inner.id, ...ancestorIds(s.groups, inner.id)] : [])];
      const firstShown = (i: number): Promise<Awaited<ReturnType<typeof measureRow>>> =>
        i >= keys.length ? Promise.resolve(null) : measureRow(windowId, keys[i]!).then((row) => row ?? firstShown(i + 1));
      void firstShown(0).then((row) =>
        view.measureInWindow((_x, y) => row && mine === reveals && show(row.y - y + (scrollY.current ?? 0), row.height)),
      );
    };
    const schedule = () => {
      if ((switched || opened) && !frame) frame = requestAnimationFrame(reveal);
    };
    const unsubscribe = useBrowser.subscribe((s, prev) => {
      if (s.windows === prev.windows && s.tabs === prev.tabs) return;
      const active = activeTabId(s, windowId);
      if (active && active !== activeTabId(prev, windowId)) switched = active;
      const w = s.windows[windowId];
      const before = prev.windows[windowId];
      if (w && before && w.tabIds !== before.tabIds) {
        const had = new Set(before.tabIds);
        for (const id of w.tabIds) if (!had.has(id) && s.tabs[id]?.openerId && id !== active) opened = id;
      }
      schedule();
    });
    geometry.current.laidOut = schedule;
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
      geometry.current.laidOut = undefined;
    };
  }, [windowId]);
}

function DownloadsButton({ windowId }: { windowId: string }) {
  return (
    <IconButton
      icon="arrow.down.circle"
      size={16}
      box={34}
      radius={10}
      tooltip="Downloads (⇧⌘J)"
      onPress={() => {
        const s = useBrowser.getState();
        s.setDownloadsOpen(windowId, !s.windowUi[windowId]?.downloadsOpen);
      }}
    />
  );
}

const CLIPPED = { marginTop: -layout.rowGap, paddingTop: layout.rowGap, overflow: "hidden" } as const;
const NEW_TAB_LABEL_X = 30;
const CLEANED_HINT_RIGHT = 30;
const CLEANED_HINT_GAP = 8;
const MEASURE_OFFSCREEN = { position: "absolute", width: 1000, height: 0, overflow: "hidden", opacity: 0 } as const;

const NewTabRow = memo(function NewTabRow({ windowId, shift = null, clip = null }: { windowId: string; shift?: Animated.Value | null; clip?: ClipSource | null }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const cleaned = useBrowser((s) => cleanedTabsFor(s, windowId).length);
  const { hovered, hoverProps } = useHover();
  const [moved, movedRef] = useShift(shift);
  const [movedButtons, movedButtonsRef] = useShift(shift);
  const clipped = useClipped(clip);
  const [widths, setWidths] = useState({ row: 0, label: 0, hint: 0 });
  const measure = (key: keyof typeof widths) => (e: LayoutChangeEvent) => {
    const width = Math.ceil(e.nativeEvent.layout.width);
    setWidths((w) => (w[key] === width ? w : { ...w, [key]: width }));
  };
  const hint = `${cleaned} cleaned`;
  const hintFits = widths.hint > 0 && NEW_TAB_LABEL_X + widths.label + CLEANED_HINT_GAP + widths.hint <= widths.row - CLEANED_HINT_RIGHT;
  return (
    <View {...hoverProps} onLayout={measure("row")} style={[{ flexDirection: "row", alignItems: "center" }, clipped ? CLIPPED : null]}>
      <View pointerEvents="none" style={MEASURE_OFFSCREEN}>
        <Text numberOfLines={1} style={{ alignSelf: "flex-start", fontSize: 13 }} onLayout={measure("label")}>
          New Tab
        </Text>
        {cleaned > 0 ? (
          <Text numberOfLines={1} style={{ alignSelf: "flex-start", fontSize: 11 }} onLayout={measure("hint")}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Pressable
        style={{ flex: 1 }}
        onPress={(e) => {
          if ((e.nativeEvent as unknown as { altKey?: boolean }).altKey) openNewTabInSplit(windowId);
          else toggleNewTabBar(windowId) || useBrowser.getState().newTab(windowId);
        }}
      >
        {({ pressed }) => (
          <View
            {...moved}
            ref={movedRef}
            style={[
              {
                height: layout.rowHeight,
                borderRadius: 10,
                flexDirection: "row",
                alignItems: "center",
                paddingLeft: 9,
                paddingRight: 34,
                backgroundColor: pressed ? theme.tabPressed : hovered ? theme.tabHover : undefined,
              },
              moved.style as object,
            ]}
          >
            <Symbol name="plus" size={13} weight="medium" color={tokens.newTabIcon} style={{ width: 16, height: 16 }} />
            <FadeLabel text="New Tab" fontSize={13} color={tokens.newTabLabel} style={{ flex: 1, height: 18, marginLeft: 5 }} />
          </View>
        )}
      </Pressable>
      <View {...movedButtons} ref={movedButtonsRef} style={[{ position: "absolute", right: 6, flexDirection: "row", alignItems: "center" }, movedButtons.style as object]}>
        <HoverSlot hovered={hovered && cleaned > 0 && hintFits} width={0} hover={<Text style={{ fontSize: 11, color: theme.textTertiary, marginRight: 2 }}>{hint}</Text>} />
        <IconButton
          icon="chevron.down"
          size={10}
          weight="semibold"
          box={22}
          radius={6}
          color={hovered ? theme.textSecondary : theme.textTertiary}
          tooltip="Open and recently closed tabs"
          onPress={() => void openOverflowMenu(windowId)}
        />
      </View>
    </View>
  );
});

const UPSELL_MIN = 10;
let upsellDeclined = false;

const CleanUpUpsell = memo(function CleanUpUpsell({ windowId, shift }: { windowId: string; shift: Animated.Value | null }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const [count, setCount] = useState(0);
  const [hidden, setHidden] = useState(upsellDeclined);
  const daily = useBrowser((s) => s.settings.cleanUpInactiveTabsAfterHours !== null);
  useEffect(() => {
    const check = () => setCount(cleanUpCandidates(useBrowser.getState(), windowId).length);
    check();
    return everySlowly({ every: 60_000, run: check });
  }, [windowId]);
  const [moved, movedRef] = useShift(shift);
  if (hidden || daily || count < UPSELL_MIN) return null;
  const button = (title: string, onPress: () => void, primary = false) => (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <View
          style={{
            height: 24,
            borderRadius: 7,
            paddingHorizontal: 8,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? tokens.upsellButtonHover : primary ? theme.textPrimary : tokens.upsellButton,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "500", color: primary ? (theme.dark ? "#000000" : "#FFFFFF") : theme.textPrimary }}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
  const dismiss = () => {
    upsellDeclined = true;
    setHidden(true);
  };
  return (
    <View {...moved} ref={movedRef} style={[{ marginTop: 10, borderRadius: 12, padding: 10, backgroundColor: tokens.groupFill, borderWidth: 0.5, borderColor: tokens.groupStroke, gap: 8 }, moved.style as object]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Symbol name="wand.and.stars" size={12} color={theme.icon} style={{ width: 16, height: 16 }} />
        <Text style={{ flex: 1, fontSize: 12, fontWeight: "600", color: theme.textPrimary }}>{count} tabs haven’t been touched in a while</Text>
      </View>
      <Text style={{ fontSize: 12, color: theme.textSecondary }}>Ardia can tidy up for you. You can always reopen closed tabs from the ⌄ menu.</Text>
      <View style={{ gap: 6 }}>
        {button("Clean Up Once", () => {
          useBrowser.getState().cleanUpTabs(windowId);
          dismiss();
        }, true)}
        {button("Clean Up Daily", () => {
          useBrowser.getState().updateSettings({ cleanUpInactiveTabsAfterHours: 24 });
          useBrowser.getState().cleanUpTabs(windowId);
        })}
        {button("Not Now", dismiss)}
      </View>
    </View>
  );
});
