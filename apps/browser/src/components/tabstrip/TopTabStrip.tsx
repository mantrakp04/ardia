import { useEffect, useMemo } from "react";
import { Animated, StyleSheet, View, type ViewStyle } from "react-native";
import { downloadsOpenIn } from "../../state/browser/current";
import { useWindowId, useWindowProfileId } from "../../state/browser/hooks";
import { beginExternalDrag, endExternalDrag, moveExternalDrag } from "../../state/drag/tabDrag";
import { lightsCenter, TOP_STRIP_LIGHTS_CENTER } from "../../state/windows/dockMotion";
import { useWindowUiOf } from "../../state/windows/hooks";
import { usePagerPages } from "../../state/windows/profilePager";
import { DownloadsButton } from "../downloads/Downloads";
import { ProfileIndicator, useProfileIndicatorWidth } from "../profiles/ProfileIndicator";
import { Panel, WindowDragRegion } from "../ui";
import { layout, useTheme } from "../ui/theme";
import { radius } from "../ui/tokens";
import { ProfileSwipeArea } from "../window/ProfileSwipe";
import { TabDropArea, type TabDropTarget } from "../window/TabDropArea";
import { usePeek } from "../window/usePeek";
import { FloatingStrip } from "./context";
import { setTrafficLightsCenter } from "../../state/windows/nativeWindow";
import { StripPage } from "./StripPage";
import {
  CONTROLS_GAP,
  DOWNLOADS_BOX,
  FLARE,
  ITEM_HEIGHT,
  ITEM_TOP,
  LIGHTS_GAP,
  MID,
  PEEK_BORDER,
  PEEK_HEIGHT,
  PEEK_HOVER_HEIGHT,
  PEEK_LEFT,
  PEEK_PAD,
  PEEK_SHADOW,
  PEEK_TOP,
  PROFILE_ROOM,
  TAB_RADIUS,
  TOP_STRIP_HEIGHT,
} from "./tokens";
import { WindowDropGlow } from "./WindowDropGlow";

export { TOP_CARD_INSET, TOP_STRIP_HEIGHT } from "./tokens";

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
          <DownloadsButton windowId={windowId} />
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
  const place = useMemo(() => ({ left: left - 4, right: right - 4, top: ITEM_TOP - 1, height: ITEM_HEIGHT + 2, borderRadius: TAB_RADIUS + 1 }), [left, right]);
  return <WindowDropGlow place={place} />;
}

export function TopStripPeek({ windowWidth, enabled }: { windowWidth: number; enabled: boolean }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const downloadsOpen = useWindowUiOf(windowId, (u) => !!u?.downloadsOpen);
  const { slide, live, show, hide, recheck } = usePeek(enabled, false, () => downloadsOpenIn(windowId));
  useEffect(() => {
    if (!downloadsOpen) recheck();
  }, [downloadsOpen]);
  useEffect(() => {
    if (!enabled) return;
    void setTrafficLightsCenter(windowId, lightsCenter(layout.sidebarWidth));
    return () => void setTrafficLightsCenter(windowId, null);
  }, [enabled, windowId]);
  const leaveStrip = (e: { nativeEvent: { clientY: number } }) => {
    if (live && e.nativeEvent.clientY < PEEK_HOVER_HEIGHT) hide();
  };
  const leavePanel = (e: { nativeEvent: { clientX: number; clientY: number } }) => {
    const x = e.nativeEvent.clientX + PEEK_LEFT;
    const y = e.nativeEvent.clientY + PEEK_TOP;
    if (!(y >= 0 && y < PEEK_HOVER_HEIGHT && x >= layout.trafficLightsWidth)) hide();
  };
  return (
    <>
      {enabled ? (
        <View
          onMouseEnter={show}
          onMouseLeave={leaveStrip}
          style={{ position: "absolute", left: layout.trafficLightsWidth, right: PEEK_LEFT, top: 0, height: PEEK_HOVER_HEIGHT }}
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
        <Panel fill={theme.windowTint[0]} radius={radius.panel} border={theme.panelBorder} borderWidth={PEEK_BORDER} shadow={PEEK_SHADOW} style={{ flex: 1 }}>
          <View style={{ position: "absolute", left: 0, right: 0, top: PEEK_PAD - ITEM_TOP, height: TOP_STRIP_HEIGHT }}>
            <TopTabStrip floating swipe={live} width={windowWidth - 12 - PEEK_BORDER * 2} />
          </View>
        </Panel>
      </Animated.View>
    </>
  );
}
