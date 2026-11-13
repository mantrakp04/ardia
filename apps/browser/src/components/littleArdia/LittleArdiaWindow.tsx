import { Button, ContextMenuArea, PinchArea, pinchScale, pinchSettle, reduceMotion, useHover, WindowBackdrop, WindowDragRegion, type PinchMotion, type SwipeEvent } from "../ui";
import { setTrafficLightsCenter } from "../../state/windows/nativeWindow";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { useTheme } from "../ui/theme";
import { useProfileOrder } from "../../state/profiles/hooks";
import { openPanel } from "../../state/windows/actions";
import { useActiveTab, useSettings, useWindowFullScreen, useWindowId, useWindowProfile, useWindowUi } from "../../state/browser/hooks";
import type { Tab } from "../../state/browser/types";
import { CommandPanel } from "../omnibox/CommandPanel";
import { ContentCard } from "../window/ContentCard";
import { DownloadsPopover } from "../downloads/Downloads";
import { ExtensionOverlays } from "../extensions/ExtensionOverlays";
import { ToolbarPopupAnchor } from "../extensions/ToolbarExtensions";
import { setUrlAnchor, usePageFrameInset } from "../../state/windows/layout";
import { showUrlBarMenu } from "../../state/omnibox/paste";
import { copyPageUrl } from "../../state/site/selection";
import { ProfileBadge } from "../profiles/ProfileIcons";
import { closeLittleArdia, openInMainWindow, openLittleArdiaProfileMenu } from "../../state/littleArdia/actions";
import { isWindowClosing } from "../../state/windows/closeAnimated";
import { notePinch, noteSwipeClose } from "../../state/telemetry/usage";
import { SwipeCloseContext } from "../window/swipeClose";
import { startLittleArdiaNewTabLinks } from "../../state/littleArdia/newTabLinks";
import { PageLabel, SMALL_BAR_BUTTON, SMALL_BAR_GAP, SMALL_FIELD_GAP, SMALL_INSET, SmallBar } from "./SmallChrome";
import { SMALL_BAR_HEIGHT, SMALL_LIGHTS_CENTER } from "../../state/windows/small";
import { HistoryButton } from "../toolbar/NavButtons";
import { toolbarPalette } from "../ui/toolbarColors";
import { useHistoryAvailability } from "../../state/tabs/navigation";
import { LITTLE_ARDIA_PINCH, LITTLE_ARDIA_SWIPE_CLOSE, NAV_CENTER_PAST_ZOOM, SMALL_BAR_ROW, TRAFFIC_LIGHT_PITCH } from "./tokens";

const NAV_LEFT = SMALL_LIGHTS_CENTER[0] + 2 * TRAFFIC_LIGHT_PITCH + NAV_CENTER_PAST_ZOOM - SMALL_BAR_BUTTON / 2;
const NAV_PITCH = SMALL_BAR_BUTTON + SMALL_BAR_GAP;
const FIELD_LEFT = NAV_LEFT + NAV_PITCH + SMALL_BAR_BUTTON + SMALL_FIELD_GAP;
const FIELD_MAX_WIDTH = 520;
const NAV_HIT = { width: SMALL_BAR_BUTTON, height: SMALL_BAR_BUTTON, plateX: 0, plateY: 0, box: SMALL_BAR_ROW.button, radius: SMALL_BAR_ROW.buttonRadius };
const BUTTON_TOP = (SMALL_BAR_HEIGHT - SMALL_BAR_BUTTON) / 2;
const BACK_AT = { style: { position: "absolute" as const, top: BUTTON_TOP, left: NAV_LEFT }, hit: NAV_HIT };
const FORWARD_AT = { style: { position: "absolute" as const, top: BUTTON_TOP, left: NAV_LEFT + NAV_PITCH }, hit: NAV_HIT };
const alreadyFocused = () => {};

export function LittleArdiaWindow() {
  const theme = useTheme();
  const windowId = useWindowId();
  const fullScreen = useWindowFullScreen(windowId);
  const [width, setWidth] = useState(0);
  const frame = usePageFrameInset();
  const gestures = useSettings((s) => s.littleWindowGestures) && !fullScreen;
  const pinch = useLittleArdiaPinch(windowId);
  const swipe = useLittleArdiaSwipeClose(windowId);
  useEffect(startLittleArdiaNewTabLinks, []);
  return (
    <View style={{ flex: 1 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Animated.View style={{ ...StyleSheet.absoluteFillObject, opacity: swipe.opacity, transform: [{ translateX: swipe.x }] }}>
        <WindowBackdrop vibrancy {...theme.backdrop} colors={theme.windowTint} grainOpacity={theme.grain} style={StyleSheet.absoluteFill} />
        <PinchArea enabled={gestures} motion={pinch.motion} style={StyleSheet.absoluteFill}>
          <Animated.View style={{ flex: 1, transform: [{ scale: pinch.scale }] }}>
            <SwipeCloseContext.Provider value={gestures ? swipe.onSwipe : null}>
              <View style={{ flex: 1, flexDirection: "row", paddingTop: SMALL_BAR_HEIGHT, paddingLeft: frame, paddingRight: frame, paddingBottom: frame }}>
                <ContentCard />
              </View>
            </SwipeCloseContext.Provider>
            <View style={{ position: "absolute", left: 0, right: 0, top: 0 }}>
              <LittleArdiaBar />
            </View>
          </Animated.View>
        </PinchArea>
      </Animated.View>
      <CommandPanel windowWidth={width} />
      <DownloadsPopover />
      <ExtensionOverlays />
    </View>
  );
}

function useLittleArdiaPinch(windowId: string) {
  const [scale] = useState(() => new Animated.Value(1));
  const leaving = useRef(false);
  const settle = () => pinchSettle([{ value: scale, to: 1 }]);
  const motion: PinchMotion = {
    get reduce() {
      return reduceMotion() === true;
    },
    idle: () => leaving.current || isWindowClosing(windowId),
    begin: () => scale.stopAnimation(),
    follow: (magnification) => scale.setValue(pinchScale(magnification, LITTLE_ARDIA_PINCH.smallest, LITTLE_ARDIA_PINCH.largest)),
    settle,
    open: () => {
      notePinch("littleArdia", "open");
      openInMainWindow(windowId);
      settle();
    },
    close: () => {
      notePinch("littleArdia", "close");
      leaving.current = true;
      closeLittleArdia(windowId);
      if (isWindowClosing(windowId)) return;
      leaving.current = false;
      settle();
    },
  };
  return { scale, motion };
}

function useLittleArdiaSwipeClose(windowId: string) {
  const [x] = useState(() => new Animated.Value(0));
  const opacity = useMemo(() => x.interpolate({ inputRange: [0, LITTLE_ARDIA_SWIPE_CLOSE.fadeOver], outputRange: [1, 0], extrapolate: "clamp" }), [x]);
  const settle = () => pinchSettle([{ value: x, to: 0 }]);
  const close = () => {
    noteSwipeClose(true);
    if (reduceMotion() === true) return closeLittleArdia(windowId);
    Animated.timing(x, { toValue: LITTLE_ARDIA_SWIPE_CLOSE.fadeOver, duration: LITTLE_ARDIA_SWIPE_CLOSE.leaveMs, useNativeDriver: true }).start(() => {
      closeLittleArdia(windowId);
      if (!isWindowClosing(windowId)) x.setValue(0);
    });
  };
  const onSwipe = (e: SwipeEvent) => {
    if (isWindowClosing(windowId)) return;
    if (e.phase === "swipe") return close();
    if (e.phase === "began") return x.stopAnimation();
    if (e.phase === "changed") return x.setValue(Math.max(0, e.distance));
    if (e.phase === "ended" && (e.distance >= LITTLE_ARDIA_SWIPE_CLOSE.distance || (e.distance > 0 && e.velocity >= LITTLE_ARDIA_SWIPE_CLOSE.velocity))) return close();
    if (e.phase === "ended" || e.phase === "cancelled") {
      noteSwipeClose(false);
      settle();
    }
  };
  return { x, opacity, onSwipe };
}

function LittleArdiaBar() {
  const windowId = useWindowId();
  const tab = useActiveTab();
  const panelOpen = useWindowUi().panel.open;
  const severalProfiles = useProfileOrder((order) => order.length > 1);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    void setTrafficLightsCenter(windowId, SMALL_LIGHTS_CENTER);
  }, [windowId]);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const copy = () => {
    if (!tab?.url) return;
    void copyPageUrl(tab.id);
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1400);
  };

  return (
    <SmallBar
      fieldLeft={FIELD_LEFT}
      fieldMaxWidth={FIELD_MAX_WIDTH}
      field={tab ? <PageField tab={tab} windowId={windowId} hidden={panelOpen} /> : null}
      buttons={[
        { icon: copied ? "checkmark" : "link", disabled: !tab?.url, tooltip: "Copy Link (⇧⌘C)", onPress: copy },
        { icon: "arrow.up.left.and.arrow.down.right", tooltip: "Open in Ardia (⌘O)", onPress: () => openInMainWindow(windowId) },
      ]}
      trailing={severalProfiles ? <ProfileButton windowId={windowId} /> : undefined}
    >
      <WindowDragRegion style={StyleSheet.absoluteFill} />
      {tab ? <HistoryButtons tabId={tab.id} windowId={windowId} /> : null}
      {tab ? <ToolbarPopupAnchor windowId={windowId} tabId={tab.id} top={BUTTON_TOP} right={SMALL_INSET} /> : null}
    </SmallBar>
  );
}

function HistoryButtons({ tabId, windowId }: { tabId: string; windowId: string }) {
  const palette = toolbarPalette(useTheme(), null);
  const history = useHistoryAvailability(tabId);
  return (
    <>
      <HistoryButton place={BACK_AT} tabId={tabId} windowId={windowId} direction={-1} disabled={!history.back} palette={palette} onFocus={alreadyFocused} />
      <HistoryButton place={FORWARD_AT} tabId={tabId} windowId={windowId} direction={1} disabled={!history.forward} palette={palette} onFocus={alreadyFocused} />
    </>
  );
}

function ProfileButton({ windowId }: { windowId: string }) {
  const profile = useWindowProfile();
  return (
    <Button variant="icon" look="row" tooltip={`Profile: ${profile.name}`} onPress={() => void openLittleArdiaProfileMenu(windowId)}>
      <ProfileBadge profile={profile} size={16} />
    </Button>
  );
}

function PageField({ tab, windowId, hidden }: { tab: Tab; windowId: string; hidden: boolean }) {
  const { hovered, hoverProps } = useHover();
  const field = useRef<View>(null);
  const anchor = () =>
    field.current?.measureInWindow((x, y, width, height) => {
      if (width) setUrlAnchor(windowId, { left: x, top: y, width, sidebar: { height } });
    });

  return (
    <View ref={field} onLayout={anchor} {...hoverProps} style={{ flex: 1, opacity: hidden ? 0 : 1 }}>
      <ContextMenuArea style={{ flex: 1 }} onContextMenu={() => tab.url && void showUrlBarMenu(tab)}>
        <WindowDragRegion
          clickable
          accessibilityRole="button"
          onRegionClick={() => openPanel(windowId, tab.url)}
          style={{ flex: 1 }}
        >
          <PageLabel tab={tab} hovered={hovered} />
        </WindowDragRegion>
      </ContextMenuArea>
    </View>
  );
}
