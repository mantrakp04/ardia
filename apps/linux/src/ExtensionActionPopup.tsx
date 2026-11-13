import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import type { WebViewHandle } from "@ardia-real/ardiacore";
import { closeExtensionPopup } from "../../browser/src/state/extensions/actions";
import { useShownPageId } from "../../browser/src/state/peek/hooks";
import { openFromPage, pageProfileId } from "../../browser/src/state/tabs/openFromPage";
import { curve, duration, PANEL, Panel, shadow } from "../../browser/src/components/ui";
import { EXTENSION_PAGE_BACKGROUND, useExtensionColors } from "../../browser/src/components/extensions/tokens";
import type { NativeFrame } from "./hostExtensionView";
import { HostExtensionWebView } from "./shims/web/HostExtensionWebView";
import { useInputRegion } from "./shellAbove";
import { GlassOptIn } from "./shellGlass";

const ROOM_MARGIN = 8;
const ANCHOR_GAP = 6;

function useDevicePixelRatio() {
  const [ratio, setRatio] = useState(() => window.devicePixelRatio || 1);
  useEffect(() => {
    let query: MediaQueryList | null = null;
    const watch = () => {
      setRatio(window.devicePixelRatio || 1);
      query?.removeEventListener("change", watch);
      query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      query.addEventListener("change", watch);
    };
    watch();
    return () => query?.removeEventListener("change", watch);
  }, []);
  return ratio;
}

export function ActionPopup({ windowId, pageProfile, url, anchor }: { windowId: string; pageProfile: string; extensionId: string; url: string; anchor: { x: number; y: number; width: number; height: number } }) {
  const colors = useExtensionColors();
  const web = useRef<WebViewHandle>(null);
  const panel = useRef<View & Element>(null);
  const screen = useWindowDimensions();
  const ratio = useDevicePixelRatio();
  const [windowWidth, setWindowWidth] = useState(0);
  const [frame, setFrame] = useState<NativeFrame | null>(null);
  const appear = useRef(new Animated.Value(0)).current;
  const revealed = !!frame?.reveal;

  const tabId = useShownPageId(windowId);
  const openedOn = useRef(tabId);
  useEffect(() => {
    if (tabId !== openedOn.current) closeExtensionPopup();
  }, [tabId]);

  useEffect(() => {
    appear.stopAnimation();
    appear.setValue(0);
    if (revealed) Animated.timing(appear, { toValue: 1, duration: duration.base, easing: curve.enter, useNativeDriver: true }).start();
  }, [revealed]);

  useInputRegion(panel);

  const border = 1 / ratio;
  const room = windowWidth || screen.width;
  const placement = {
    anchor: { right: anchor.x + anchor.width - border, top: anchor.y + anchor.height + ANCHOR_GAP + border },
    room: { left: ROOM_MARGIN + border, right: room - ROOM_MARGIN - border, bottom: screen.height - ROOM_MARGIN - border },
    radius: Math.max(0, PANEL.radius - border),
    fadeMs: duration.base,
  };
  const box = frame
    ? { left: frame.x - border, top: frame.y - border, width: frame.width + 2 * border, height: frame.height + 2 * border }
    : { left: placement.anchor.right, top: placement.anchor.top, width: 0, height: 0 };

  return (
    <>
      <Pressable testID="ardia-extension-popup-dismiss" style={StyleSheet.absoluteFill} onPress={closeExtensionPopup} onLayout={(e) => setWindowWidth(e.nativeEvent.layout.width)} />
      <Animated.View ref={panel} testID="ardia-extension-popup" style={{ position: "absolute", ...box, opacity: appear, display: revealed ? "flex" : "none" }}>
        <GlassOptIn.Provider value={true}>
          <Panel radius={PANEL.radius} border={colors.popupBorder} borderWidth={border} shadow={shadow.card} style={{ width: box.width, height: box.height }}>
            <View style={{ flex: 1, borderRadius: placement.radius, overflow: "hidden" }}>
              <HostExtensionWebView
                ref={web}
                style={StyleSheet.absoluteFill}
                url={url}
                profile={pageProfile}
                standalone
                extensionHost="popup"
                pageBackgroundColor={EXTENSION_PAGE_BACKGROUND}
                placement={placement}
                decorationVisible={() => {
                  const node = panel.current as unknown as Element | null;
                  if (!node || !node.isConnected) return false;
                  const style = getComputedStyle(node);
                  return style.visibility !== "hidden" && style.display !== "none";
                }}
                onNativeFrame={setFrame}
                onNavigationChange={({ isLoading }) => {
                  if (!isLoading) void web.current?.focus();
                }}
                onWindowClose={closeExtensionPopup}
                onOpenWindow={(request) => {
                  openFromPage(request, { windowId, profileId: pageProfileId(windowId, pageProfile) });
                  if (request.disposition !== "background") closeExtensionPopup();
                }}
              />
            </View>
          </Panel>
        </GlassOptIn.Provider>
      </Animated.View>
    </>
  );
}
