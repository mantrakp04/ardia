import { Box, Button, Divider, springs, Text, WebView, type WebViewHandle } from "../ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, PanResponder, StyleSheet, View } from "react-native";
import { useTheme } from "../ui/theme";
import { useCardFrame } from "../window/cardFrame";
import { useSettings, useWindowId } from "../../state/browser/hooks";
import { useBrowser } from "../../state/browser/store";
import { currentSettings } from "../../state/browser/current";
import { updateSettings } from "../../state/settings/actions";
import { openFromPage, pageProfileId } from "../../state/tabs/openFromPage";
import { space } from "../ui/tokens";
import { EXTENSION_PAGE_BACKGROUND, SIDE_PANEL_HEADER_PAD_RIGHT } from "./tokens";
import { closeSidePanel, closeSidePanelOnTab, findExtension, panelClosedOnTab, panelTabOpen, showExtensionMenu, shownReadyTab, takeSidePanelFocus, useExtensions, type SidePanel } from "../../state/extensions/actions";
import { curve, duration } from "../ui/motion";
import { GLYPH } from "../toolbar/tokens";

const MIN_WIDTH = 320;
const MAX_WIDTH = 600;
const HEADER = 40;

function rubberBand(width: number): number {
  const band = (over: number) => 36 * (1 - Math.exp(-over / 90));
  if (width > MAX_WIDTH) return MAX_WIDTH + band(width - MAX_WIDTH);
  if (width < MIN_WIDTH) return MIN_WIDTH - band(MIN_WIDTH - width);
  return width;
}
const panelKey = (p: SidePanel) => `${p.extensionId}|${p.pageProfile}|${p.url}`;
const alive = (p: SidePanel, currentKey: string) => panelTabOpen(p.tabId) || panelKey(p) === currentKey;
const clamp = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));

export function ExtensionSidePanel() {
  const windowId = useWindowId();
  const entry = useExtensions((e) => e.sidePanels[windowId]);
  const panel = entry && !entry.hidden ? entry : undefined;
  const state = !entry ? "closed" : entry.hidden ? "hidden" : "shown";
  const savedWidth = useSettings((st) => st.extensionSidePanelWidth ?? 360);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const appear = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(panel);
  const gap = useCardFrame().splitGap;
  const [kept, setKept] = useState<SidePanel[]>(panel ? [panel] : []);
  const shownKey = useRef("");
  const entryNow = useRef(entry);
  useEffect(() => {
    shownKey.current = panel && shown ? panelKey(shown) : "";
    entryNow.current = entry;
  });

  const lastSeen = useRef<{ state: string; tab?: string }>({ state: "closed" });

  useEffect(() => {
    if (panel) setShown(panel);
    else setKept((k) => k.filter((p) => panelTabOpen(p.tabId) && !panelClosedOnTab(windowId, p.tabId)));
    const tab = shownReadyTab(windowId);
    const before = lastSeen.current;
    const tabSwitch = before.state !== "closed" && state !== "closed" && !!tab && tab !== before.tab;
    Animated.timing(appear, { toValue: panel ? 1 : 0, duration: tabSwitch ? 0 : duration.base, easing: curve.enter, useNativeDriver: false }).start(({ finished }) => {
      if (!finished || entryNow.current) return;
      setShown(undefined);
      setKept([]);
    });
  }, [state]);
  useEffect(() => {
    lastSeen.current = { state, tab: shownReadyTab(windowId) };
  });
  useEffect(() => {
    if (!panel) return;
    setShown(panel);
    setKept((k) => {
      const keep = (p: SidePanel) => panelKey(p) === panelKey(panel) || (!!p.tabId && p.tabId !== panel.tabId && alive(p, panelKey(panel)));
      const next = k.filter(keep);
      return next.some((p) => panelKey(p) === panelKey(panel)) ? next.map((p) => (panelKey(p) === panelKey(panel) ? panel : p)) : [...next, panel];
    });
  }, [panel && panelKey(panel), panel?.tabId, panel?.opened]);
  useEffect(
    () =>
      useBrowser.subscribe((s, prev) => {
        if (s.tabs === prev.tabs) return;
        setKept((k) => {
          const open = k.filter((p) => alive(p, shownKey.current));
          return open.length === k.length ? k : open;
        });
      }),
    [],
  );

  const width = dragWidth ?? savedWidth;
  const start = useRef(width);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          start.current = currentSettings().extensionSidePanelWidth ?? 360;
          setDragWidth(start.current);
        },
        onPanResponderMove: (_, g) => setDragWidth(rubberBand(start.current - g.dx)),
        onPanResponderRelease: (_, g) => {
          const raw = rubberBand(start.current - g.dx);
          const target = clamp(raw);
          const finish = () => {
            updateSettings({ extensionSidePanelWidth: target });
            setDragWidth(null);
          };
          if (raw === target) return finish();
          const value = new Animated.Value(raw);
          value.addListener(({ value: v }) => setDragWidth(v));
          Animated.spring(value, { toValue: target, ...springs.bouncy, useNativeDriver: false }).start(() => {
            value.removeAllListeners();
            finish();
          });
        },
        onPanResponderTerminate: () => setDragWidth(null),
        onPanResponderTerminationRequest: () => false,
      }),
    [],
  );

  if (!shown) return null;
  const room = width + gap;
  return (
    <Animated.View style={{ width: appear.interpolate({ inputRange: [0, 1], outputRange: [0, room] }), overflow: "hidden" }}>
      <Animated.View style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: width, opacity: appear }}>
        {kept.map((p) => {
          const current = !!panel && panelKey(p) === panelKey(shown);
          const close = () => (current ? closeSidePanel(windowId, p.extensionId) : setKept((k) => k.filter((x) => panelKey(x) !== panelKey(p))));
          return <PanelCard key={panelKey(p)} windowId={windowId} panel={p} current={current} onWindowClose={close} />;
        })}
        <View
          {...responder.panHandlers}
          onDoubleClick={() => updateSettings({ extensionSidePanelWidth: 360 })}
          style={{ position: "absolute", top: 0, bottom: 0, left: -3, width: 7, cursor: "col-resize" }}
        />
      </Animated.View>
    </Animated.View>
  );
}

function PanelCard({ windowId, panel, current, onWindowClose }: { windowId: string; panel: SidePanel; current: boolean; onWindowClose: () => void }) {
  const { extensionId, profile, pageProfile, url, opened } = panel;
  const theme = useTheme();
  const cardRadius = useCardFrame().radius;
  const web = useRef<WebViewHandle>(null);
  const [loaded, setLoaded] = useState(false);
  const lookingUp = useExtensions((e) => !!e.sidePanelLookups[windowId]);
  useEffect(() => {
    if (current && loaded && takeSidePanelFocus(windowId, panel)) void web.current?.focus();
  }, [current, loaded, opened, lookingUp]);
  const ext = useExtensions((e) => e.lists[profile]?.find((x) => x.id === extensionId));
  const title = ext?.actionTitle || ext?.name || "Extension";
  const icon = ext?.actionIcon || ext?.icon;
  return (
    <View
      pointerEvents={current ? "auto" : "none"}
      style={{ ...StyleSheet.absoluteFillObject, opacity: current ? 1 : 0, borderRadius: cardRadius, overflow: "hidden", backgroundColor: theme.card }}
    >
      <Box row gap="m" style={HEADER_ROW}>
        {icon ? <Image source={{ uri: icon }} style={{ width: 16, height: 16 }} /> : null}
        <Text numberOfLines={1} weight="medium" style={FLEX}>
          {title}
        </Text>
        <Button variant="icon"
          icon="ellipsis"
          glyph={GLYPH}
          tooltip="More"
          onPress={() => {
            const found = findExtension(profile, extensionId);
            if (found) void showExtensionMenu(windowId, found);
          }}
        />
        <Button variant="icon" icon="xmark" glyph={GLYPH} weight="medium" tooltip="Close Side Panel" onPress={() => closeSidePanelOnTab(windowId)} />
      </Box>
      <Divider />
      <View style={PAGE}>
        <WebView
          ref={web}
          style={StyleSheet.absoluteFill}
          url={url}
          profile={pageProfile}
          standalone
          visible={current}
          warm={!current}
          extensionHost="sidePanel"
          pageBackgroundColor={EXTENSION_PAGE_BACKGROUND}
          onNavigationChange={({ isLoading }) => {
            if (!isLoading) setLoaded(true);
          }}
          onWindowClose={onWindowClose}
          onCrashed={current ? undefined : onWindowClose}
          onOpenWindow={(request) => openFromPage(request, { windowId, profileId: pageProfileId(windowId, pageProfile) })}
        />
      </View>
    </View>
  );
}

const FLEX = { flex: 1 } as const;
const HEADER_ROW = { height: HEADER, alignItems: "center", paddingLeft: space.l, paddingRight: SIDE_PANEL_HEADER_PAD_RIGHT } as const;
const PAGE = { flex: 1, backgroundColor: EXTENSION_PAGE_BACKGROUND } as const;
