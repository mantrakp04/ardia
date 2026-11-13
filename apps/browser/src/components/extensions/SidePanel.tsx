import { useMemo } from "react";
import { useInterfaceMetrics, scaleInterfaceStyle } from "../ui/interfaceSize";
import { scaleMetrics } from "../../lib/interfaceMetrics";
import { Box, Button, Divider, Text, WebView, type WebViewHandle } from "../ui";
import { useEffect, useRef, useState } from "react";
import { Animated, Image, StyleSheet, View } from "react-native";
import { useTheme } from "../ui/theme";
import { useCardFrame } from "../window/cardFrame";
import { useSettings, useWindowId } from "../../state/browser/hooks";
import { currentSettings } from "../../state/browser/current";
import { updateSettings } from "../../state/settings/actions";
import { DEFAULT_SETTINGS } from "../../state/settings/settings";
import { openFromPage, pageProfileId } from "../../state/tabs/openFromPage";
import { space } from "../ui/tokens";
import { EXTENSION_PAGE_BACKGROUND, SIDE_PANEL_HEADER_PAD_RIGHT } from "./tokens";
import { closeSidePanel, findExtension, showExtensionMenu, takeSidePanelFocus, useExtensions, type SidePanel } from "../../state/extensions/actions";
import { curve, duration } from "../ui/motion";
import { GLYPH } from "../toolbar/tokens";
import { useResizeDrag } from "../sidebar/useResizeDrag";

const MIN_WIDTH = 320;
const MAX_WIDTH = 600;
const HEADER = 40;

export function ExtensionSidePanel() {
  const interfaceScale = useInterfaceMetrics().factor;
  const { MIN_WIDTH, MAX_WIDTH } = useMemo(() => ({ MIN_WIDTH: scaleMetrics(BASE_INTERFACE_METRICS.MIN_WIDTH, interfaceScale), MAX_WIDTH: scaleMetrics(BASE_INTERFACE_METRICS.MAX_WIDTH, interfaceScale) }), [interfaceScale]);
  const windowId = useWindowId();
  const panel = useExtensions((e) => e.sidePanels[windowId]);
  const savedWidth = useSettings((st) => st.extensionSidePanelWidth);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const appear = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(panel);
  const gap = useCardFrame().splitGap;

  useEffect(() => {
    if (panel) setShown(panel);
    Animated.timing(appear, { toValue: panel ? 1 : 0, duration: duration.base, easing: curve.enter, useNativeDriver: false }).start(({ finished }) => {
      if (finished && !panel) setShown(undefined);
    });
  }, [!!panel, interfaceScale]);
  useEffect(() => {
    if (panel) setShown(panel);
  }, [panel?.url, panel?.extensionId, panel?.opened, interfaceScale]);

  const width = dragWidth ?? savedWidth;
  const resizeHandlers = useResizeDrag({
    min: MIN_WIDTH,
    max: MAX_WIDTH,
    direction: -1,
    saved: () => currentSettings().extensionSidePanelWidth,
    onLive: setDragWidth,
    onCommit: (w) => updateSettings({ extensionSidePanelWidth: w }),
  });

  if (!shown) return null;
  const room = width + gap;
  return (
    <Animated.View style={{ width: appear.interpolate({ inputRange: [0, 1], outputRange: [0, room] }), overflow: "hidden" }}>
      <Animated.View style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: width, opacity: appear }}>
        <PanelCard key={`${shown.extensionId}|${shown.pageProfile}|${shown.url}`} windowId={windowId} panel={shown} />
        <View
          {...resizeHandlers}
          onDoubleClick={() => updateSettings({ extensionSidePanelWidth: DEFAULT_SETTINGS.extensionSidePanelWidth })}
          style={{ position: "absolute", top: 0, bottom: 0, left: -3, width: 7 * interfaceScale, cursor: "col-resize" }}
        />
      </Animated.View>
    </Animated.View>
  );
}

function PanelCard({ windowId, panel }: { windowId: string; panel: SidePanel }) {
  const interfaceScale = useInterfaceMetrics().factor;
  const { HEADER_ROW, FLEX, GLYPH, PAGE, EXTENSION_PAGE_BACKGROUND } = useMemo(() => ({ HEADER_ROW: scaleInterfaceStyle(BASE_INTERFACE_METRICS.HEADER_ROW, interfaceScale), FLEX: scaleInterfaceStyle(BASE_INTERFACE_METRICS.FLEX, interfaceScale), GLYPH: scaleMetrics(BASE_INTERFACE_METRICS.GLYPH, interfaceScale), PAGE: scaleInterfaceStyle(BASE_INTERFACE_METRICS.PAGE, interfaceScale), EXTENSION_PAGE_BACKGROUND: scaleMetrics(BASE_INTERFACE_METRICS.EXTENSION_PAGE_BACKGROUND, interfaceScale) }), [interfaceScale]);
  const { extensionId, profile, pageProfile, url, opened } = panel;
  const theme = useTheme();
  const cardRadius = useCardFrame().radius;
  const web = useRef<WebViewHandle>(null);
  const [loaded, setLoaded] = useState(false);
  const lookingUp = useExtensions((e) => !!e.sidePanelLookups[windowId]);
  useEffect(() => {
    if (loaded && takeSidePanelFocus(windowId, panel)) void web.current?.focus();
  }, [loaded, opened, lookingUp, interfaceScale]);
  const ext = useExtensions((e) => e.lists[profile]?.find((x) => x.id === extensionId));
  const title = ext?.actionTitle || ext?.name || "Extension";
  const icon = ext?.actionIcon || ext?.icon;
  return (
    <View style={{ flex: 1, borderRadius: cardRadius, overflow: "hidden", backgroundColor: theme.card }}>
      <Box row gap="m" style={HEADER_ROW}>
        {icon ? <Image source={{ uri: icon }} style={{ width: 16 * interfaceScale, height: 16 * interfaceScale }} /> : null}
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
        <Button variant="icon" icon="xmark" glyph={GLYPH} weight="medium" tooltip="Close Side Panel" onPress={() => closeSidePanel(windowId)} />
      </Box>
      <Divider />
      <View style={PAGE}>
        <WebView
          ref={web}
          style={StyleSheet.absoluteFill}
          url={url}
          profile={pageProfile}
          standalone
          extensionHost="sidePanel"
          pageBackgroundColor={EXTENSION_PAGE_BACKGROUND}
          onNavigationChange={({ isLoading }) => {
            if (!isLoading) setLoaded(true);
          }}
          onWindowClose={() => closeSidePanel(windowId, extensionId)}
          onOpenWindow={(request) => openFromPage(request, { windowId, profileId: pageProfileId(windowId, pageProfile) })}
        />
      </View>
    </View>
  );
}

const FLEX = { flex: 1 } as const;
const HEADER_ROW = { height: HEADER, alignItems: "center", paddingLeft: space.l, paddingRight: SIDE_PANEL_HEADER_PAD_RIGHT } as const;
const PAGE = { flex: 1, backgroundColor: EXTENSION_PAGE_BACKGROUND } as const;

const BASE_INTERFACE_METRICS = { MIN_WIDTH, MAX_WIDTH, HEADER_ROW, FLEX, GLYPH, PAGE, EXTENSION_PAGE_BACKGROUND };
