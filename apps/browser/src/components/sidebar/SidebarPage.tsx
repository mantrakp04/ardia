import { memo, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Animated, ScrollView, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { switchOn } from "../../state/app/switches";
import { ContextMenuArea, WindowDragRegion } from "../ui";
import { layout } from "../ui/theme";
import { ThemeScope } from "../window/ThemeScope";
import { PageProfileContext, useSettings, useWindowId } from "../../state/browser/hooks";
import { newTab } from "../../state/tabs/actions";
import { useSidebarCells } from "../../state/sidebar/hooks";
import { useAddressBarInSidebar } from "../../state/windows/layout";
import { SIDEBAR_PLAYER_HEIGHT, SidebarPlayer, useSidebarPlayerTab } from "../media/SidebarPlayer";
import { usePageStyle } from "../../state/windows/profilePager";
import { DragScope, useDragController, useDragging, usePinnedCount } from "./DragProvider";
import { openSidebarMenu } from "../../state/sidebar/menus";
import { PinnedGrid } from "./PinnedGrid";
import { pinGridHeight } from "./pinZone";
import { SCROLL_EDGE, ScrollEdgeLine, useScrollEdge } from "./ScrollEdge";
import { listTopGap } from "./geometry";
import { startsOffScreen } from "../../state/sidebar/geometry";
import { toggleNewTabBar } from "../../state/omnibox/newTabBar";
import { DOCK_SHARE, DOCKED_BOTTOM, GLOW_ROOM, type SidebarGeometry } from "./pageLayout";
import { PageRows } from "./PageRows";
import { NewTabRow } from "./NewTabRow";

const NONE: string[] = [];

type PageProps = {
  profileId: string;
  slot: number;
  width: number;
  current: boolean;
  resting: boolean;
  dockAbove: number;
  height: number;
  rows: number | undefined;
  geometry: RefObject<SidebarGeometry> | undefined;
  onScrollView: (view: ScrollView | null) => void;
  onScrollY: (y: number) => void;
};

export const SidebarPage = memo(function SidebarPage({ profileId, slot, width, current, resting, dockAbove, height, rows, geometry, onScrollView, onScrollY }: PageProps) {
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
  const playerTab = useSidebarPlayerTab(windowId, profileId);
  const playerHeight = playerTab ? SIDEBAR_PLAYER_HEIGHT : 0;
  const tiles = useSidebarCells(windowId, profileId, offScreen);
  const innerWidth = width - layout.sidebarInset * 2;
  const dragging = useDragging() && current;
  const previewed = usePinnedCount(tiles);
  const dockRoom = height ? (height - playerHeight) * DOCK_SHARE - topGap - SCROLL_EDGE.gap - SCROLL_EDGE.line : Infinity;
  const balanced = useSettings((st) => st.balancedTopApps);
  const gridHeight = (count: number) => pinGridHeight(count, innerWidth, layout.pinnedHeight, balanced);
  const placedFixed = useRef(true);
  if (!dragging) placedFixed.current = !tiles.length || gridHeight(tiles.length) <= dockRoom;
  const dockFixed = placedFixed.current;
  const capped = dockFixed && dragging && gridHeight(previewed) > dockRoom;
  const fixedTiles = dockFixed ? tiles : NONE;
  const scrolledTiles = dockFixed ? NONE : tiles;
  const pad = GLOW_ROOM + SCROLL_EDGE.inset;
  if (geometry) {
    geometry.current.room = GLOW_ROOM;
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
  const edge = useMemo(() => scrollY.interpolate({ inputRange: [0, 1], outputRange: [0, GLOW_ROOM], extrapolate: "clamp" }), [scrollY]);
  const unedge = useMemo(() => Animated.multiply(edge, -1), [edge]);
  const fixed = useRef<{ height: number; list: number | null }>({ height: 0, list: null });
  const listHeight = useRef(0);
  const [, setDockChanges] = useState(0);
  const docked = listHeight.current > dockAbove;
  const report = () => {
    if (resting || fixed.current.list === null) return;
    const before = listHeight.current > dockAbove;
    listHeight.current = fixed.current.height + fixed.current.list + playerHeight;
    if (listHeight.current > dockAbove !== before) setDockChanges((n) => n + 1);
  };
  const reportList = (list: number) => {
    fixed.current.list = list;
    report();
  };
  const onFixedLayout = (e: LayoutChangeEvent) => {
    fixed.current.height = e.nativeEvent.layout.height;
    report();
  };
  useEffect(report, [playerHeight, resting]);
  const inlineNewTab = !docked;

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
                  <View onLayout={onFixedLayout} style={{ paddingTop: GLOW_ROOM, zIndex: fixedTiles.length ? 1 : 0 }}>
                    <View style={[{ paddingHorizontal: layout.sidebarInset }, capped ? { maxHeight: topGap + dockRoom, overflow: "hidden" } : null]}>
                      {dockFixed ? <PinnedGrid tabs={fixedTiles} innerWidth={innerWidth} /> : null}
                    </View>
                    <View style={{ height: fixedTiles.length ? SCROLL_EDGE.gap : topGap - SCROLL_EDGE.inset - SCROLL_EDGE.line }} />
                    <ScrollEdgeLine opacity={scrollEdge.opacity} />
                  </View>
                  <Animated.View style={{ flex: 1, marginTop: -GLOW_ROOM, overflow: "hidden", transform: [{ translateY: edge }] }}>
                    <Animated.View style={{ flex: 1, transform: [{ translateY: unedge }] }}>
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
                          <WindowDragRegion style={{ flex: 1 }} titleBarDoubleClick={false} onRegionDoubleClick={() => toggleNewTabBar(windowId) || newTab(windowId, { newTabCommand: true })} />
                        </ContextMenuArea>
                      </Animated.ScrollView>
                    </Animated.View>
                  </Animated.View>
                  {playerTab ? (
                    <View style={{ paddingHorizontal: layout.sidebarInset, paddingTop: docked ? 8 : 0, paddingBottom: docked ? 0 : 8 }}>
                      <SidebarPlayer tabId={playerTab} />
                    </View>
                  ) : null}
                  {docked ? (
                    <View style={{ paddingHorizontal: layout.sidebarInset, paddingTop: layout.rowGap, paddingBottom: DOCKED_BOTTOM }}>
                      <NewTabRow windowId={windowId} />
                    </View>
                  ) : null}
                </TilesPlacement>
              )}
            </PageContent>
          </DragScope>
        </ThemeScope>
      </PageProfileContext.Provider>
    </Animated.View>
  );
});

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
