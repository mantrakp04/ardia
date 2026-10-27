import { appUrlOrigin, breadcrumb, urlForDisplay } from "@ardia/core";
import { memo, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { Animated, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { layout, useTheme } from "../ui/theme";
import { activate } from "../../state/tabs/actions";
import { openPanel as openWindowPanel, toggleSidebar } from "../../state/windows/actions";
import { useIsBookmarked, useSettings, useTab, useTabLive } from "../../state/browser/hooks";
import type { Tab } from "../../state/browser/types";
import { Button, ContextMenuArea, FadeLabel, font, ink, radius, Symbol, useHover, weight, WindowDragRegion } from "../ui";
import { type ToolbarGeometry } from "../window/geometry";
import { popoverOf, setPopover, usePage, usePages, type PageState } from "../../state/tabs/pageState";
import { useHistoryAvailability } from "../../state/tabs/navigation";
import { toggleBookmarkOfTab } from "../../state/bookmarks/actions";
import { closePane, openSplitPane, showSplitMenu } from "../../state/splits/actions";
import { toolbarPalette, useEasedColor, type ToolbarPalette } from "../ui/toolbarColors";
import { setToolbarExtensionsWidth } from "../../state/windows/layout";
import { SIDEBAR_FIELD } from "../sidebar/geometry";
import { showUrlBarMenu } from "../../state/omnibox/paste";
import { ToolbarExtensions, useToolbarExtensionsWidth } from "../extensions/ToolbarExtensions";
import { FIELD_GLASS_HOVER_OPACITY, FIELD_GLASS_OPACITY, GlassFill, liquidGlass } from "../ui/Glass";
import { TranslateButton } from "../site/TranslateControls";
import { ZoomIndicator } from "../site/ZoomControls";
import { useShortcutHint, withShortcut } from "../../state/commands/commandShortcuts";
import { curve } from "../ui/motion";
import { HistoryButton, ReloadButton } from "./NavButtons";
import { ProgressBar, TabProgressBar } from "./ProgressBar";
import { GLYPH, TOOLBAR_MOTION } from "./tokens";

type ToolbarTab = Pick<Tab, "id" | "url" | "title" | "windowId" | "zoom">;
const toolbarTab = (t: Tab | undefined): ToolbarTab | undefined =>
  t && { id: t.id, url: t.url, title: isWebUrl(t.url) ? "" : t.title, windowId: t.windowId, zoom: t.zoom };
const isWebUrl = (url: string) => /^https?:/i.test(url);
export const useToolbarTab = (tabId: string | undefined) => useTab(tabId, useShallow(toolbarTab));

export const URL_FIELD = { top: 21.2 - 15, height: 30 } as const;
export const urlFieldRight = (inSplit: boolean, extensionsWidth: number) => (inSplit ? 12 + 2 * 28 : 12) + extensionsWidth;
const LOCK = { left: 7, width: 18, gap: 3 } as const;
export const urlTextLeft = (insecure: boolean) => (insecure ? LOCK.left + LOCK.width + LOCK.gap : 8);
export const insecureLevel = (p: PageState) =>
  p.security && (p.security.level === "insecure" || p.security.level === "certificateError") ? p.security.level : null;

export function Toolbar({
  tabId,
  geometry,
  windowId,
  inSplit,
  focused,
  bare,
}: {
  tabId: string;
  geometry: ToolbarGeometry;
  windowId: string;
  inSplit: boolean;
  focused: boolean;
  bare?: boolean;
}) {
  const theme = useTheme();
  const sidebarHint = useShortcutHint("toggleSidebar");
  const tab = useToolbarTab(tabId);
  const isLoading = useTabLive(tabId, (l) => l.isLoading);
  const themeColor = useTabLive(tabId, (l) => l.themeColor);
  const extendColor = useSettings((s) => s.extendWebsiteColor);
  const website = extendColor && tab?.url ? themeColor : null;
  const palette = toolbarPalette(theme, website);
  const band = useEasedColor(bare ? null : palette.background);
  const history = useHistoryAvailability(tabId);
  const extensionsWidth = useToolbarExtensionsWidth(windowId);
  useEffect(() => setToolbarExtensionsWidth(windowId, extensionsWidth), [windowId, extensionsWidth]);
  const dim = useRef(new Animated.Value(focused ? 1 : 0.5)).current;
  const dimmedFor = useRef(focused);
  useEffect(() => {
    if (dimmedFor.current === focused) return;
    dimmedFor.current = focused;
    Animated.timing(dim, { toValue: focused ? 1 : 0.5, duration: TOOLBAR_MOTION.dim, easing: curve.outQuad, useNativeDriver: true }).start();
  }, [focused]);
  const focus = useCallback(() => {
    if (!focused) activate(tabId);
  }, [focused, tabId]);
  const at = useMemo(() => {
    const top = 21.2 - layout.toolbarButton / 2;
    const place = (center: number | null) => ({ position: "absolute" as const, top, left: (center ?? 0) - layout.toolbarButton / 2 });
    return { sidebarButton: place(geometry.sidebarButton), back: place(geometry.back), forward: place(geometry.forward), reload: place(geometry.reload) };
  }, [geometry]);
  const right = urlFieldRight(inSplit, extensionsWidth);
  const urlStyle = useMemo(() => ({ position: "absolute" as const, left: geometry.urlLeft, right, top: URL_FIELD.top }), [geometry.urlLeft, right]);
  if (!tab) return <View style={{ height: layout.toolbarHeight }} />;
  const top = 21.2 - layout.toolbarButton / 2;

  return (
    <View style={{ height: layout.toolbarHeight }}>
      {!bare && <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: band }]} />}
      <WindowDragRegion style={StyleSheet.absoluteFill} />
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: dim }]} pointerEvents="box-none">
        {geometry.sidebarButton !== null && (
          <Button variant="icon" toolbar
            style={at.sidebarButton}
            palette={palette}
            icon="sidebar.left"
            size={GLYPH}
            onPress={() => toggleSidebar(windowId)}
            tooltip={withShortcut("Auto-Hide Tabs", sidebarHint)}
          />
        )}
        <HistoryButton style={at.back} tabId={tab.id} windowId={tab.windowId} direction={-1} disabled={!history.back} palette={palette} onFocus={focus} />
        <HistoryButton style={at.forward} tabId={tab.id} windowId={tab.windowId} direction={1} disabled={!history.forward} palette={palette} onFocus={focus} />
        <ReloadButton style={at.reload} tab={tab} loading={isLoading} palette={palette} onFocus={focus} />
        <ToolbarExtensions tabId={tab.id} windowId={windowId} palette={palette} top={21.2 - 14} right={inSplit ? 8 + 60 : 8} />
        {tab.url ? (
          <UrlField tab={tab} palette={palette} windowId={windowId} inSplit={inSplit} onFocus={focus} style={urlStyle} />
        ) : null}
        {inSplit && (
          <View style={{ position: "absolute", top, right: 8, flexDirection: "row", gap: -2 }}>
            <Button variant="icon" toolbar palette={palette} icon="rectangle.split.2x1" size={14} box={30} onPress={() => showSplitMenu(tab.id)} tooltip="Split View" />
            <Button variant="icon" toolbar palette={palette} icon="xmark" size={12} weight="medium" box={30} onPress={() => closePane(tab.id)} tooltip="Close Pane" />
          </View>
        )}
      </Animated.View>

      {tab.url && !bare ? <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.divider }} /> : null}
      {isLoading && <TabProgressBar key={tabId} tabId={tabId} color={palette.background ? palette.icon : theme.accent} />}
    </View>
  );
}

export function ToolbarBackdrop({ tabId }: { tabId: string }) {
  const theme = useTheme();
  const url = useTab(tabId, (t) => t?.url ?? "");
  const themeColor = useTabLive(tabId, (l) => l.themeColor);
  const extendColor = useSettings((s) => s.extendWebsiteColor);
  const palette = toolbarPalette(theme, extendColor && url ? themeColor : null);
  const band = useEasedColor(palette.background);
  return (
    <View pointerEvents="none" style={{ height: layout.toolbarHeight }}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: band }]} />
      {url ? <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.divider }} /> : null}
    </View>
  );
}

export const UrlField = memo(function UrlField({
  tab,
  palette,
  windowId,
  inSplit,
  onFocus,
  style,
  sidebar,
}: {
  tab: ToolbarTab;
  palette: ToolbarPalette;
  windowId: string;
  inSplit: boolean;
  onFocus: () => void;
  style?: ViewStyle;
  sidebar?: { height: number; progress: number | null; accessory?: ReactNode };
}) {
  const theme = useTheme();
  const showFullUrl = useSettings((s) => s.showFullUrl);
  const bookmarkHint = useShortcutHint("bookmarkPage");
  const splitHint = useShortcutHint("openSplitPane");
  const bookmarked = useIsBookmarked(tab.url);
  const insecure = usePage(tab.id, insecureLevel);
  const popups = usePage(tab.id, (p) => p.popups.length);
  const capture = usePage(tab.id, (p) => p.mediaAccess);
  const openPanel = (text: string) => {
    onFocus();
    openWindowPanel(windowId, text);
  };
  const toggleBookmark = () => {
    toggleBookmarkOfTab(windowId, tab.id);
  };
  const toggleSiteControls = () => {
    onFocus();
    setPopover(tab.id, currentPopover(tab.id) === "siteControls" ? null : "siteControls");
  };
  const { hovered: pointerOver, hoverProps } = useHover();
  const popover = usePages((p) => p.popover[tab.id] ?? null);
  const hovered = pointerOver || popover === "siteControls";
  const isFile = tab.url.startsWith("file:");
  const host = isFile ? "File" : breadcrumb(tab.url).host;
  const full = isFile ? ` ${safeDecode(tab.url.slice("file://".length))}` : urlForDisplay(tab.url);
  const path = !isFile && full.startsWith(host) ? full.slice(host.length) : full;
  const web = isWebUrl(tab.url);
  const trail = hovered ? path : showFullUrl ? path.replace(/\/$/, "") : !web && appUrlOrigin(tab.url) && tab.title ? ` / ${tab.title}` : "";

  return (
    <View
      {...hoverProps}
      style={[
        style,
        { flexDirection: "row", alignItems: "center" },
        sidebar
          ? {
              height: sidebar.height,
              borderRadius: SIDEBAR_FIELD.radius,
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderColor: liquidGlass ? "transparent" : theme.pinnedRestingStroke,
              backgroundColor: liquidGlass ? undefined : hovered ? theme.tabHover : theme.pinnedResting,
              overflow: "hidden",
            }
          : { height: 30, borderRadius: radius.l, backgroundColor: hovered && !liquidGlass ? palette.pill : undefined },
      ]}
    >
      {liquidGlass ? (
        sidebar ? (
          <GlassFill tint={null} opacity={hovered ? FIELD_GLASS_HOVER_OPACITY : FIELD_GLASS_OPACITY} radius={SIDEBAR_FIELD.radius} border={StyleSheet.hairlineWidth * 2} fill={theme.pinnedResting} />
        ) : (
          <GlassFill tint={null} opacity={hovered ? FIELD_GLASS_HOVER_OPACITY : FIELD_GLASS_OPACITY} radius={radius.l} fill={palette.pill} dark={palette.background ? palette.text.startsWith(ink.white) : undefined} />
        )
      ) : null}
      {insecure && (
        <Pressable onPress={toggleSiteControls} style={{ paddingLeft: LOCK.left }} tooltip="Connection is not secure">
          <Symbol
            name="lock.open.trianglebadge.exclamationmark.fill"
            size={12}
            color={insecure === "certificateError" ? theme.destructive : palette.secondary}
            style={{ width: LOCK.width, height: 30 }}
          />
        </Pressable>
      )}
      <ContextMenuArea style={{ flex: 1 }} onContextMenu={() => void showUrlBarMenu(tab)}>
      <Pressable onPress={() => openPanel(tab.url)} style={{ flex: 1, height: sidebar?.height ?? 30, justifyContent: "center", paddingLeft: insecure ? LOCK.gap : sidebar ? 10 : urlTextLeft(false) }}>
        {sidebar ? (
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text numberOfLines={1} ellipsizeMode="head" style={{ flexShrink: 1, ...font.body, fontWeight: weight.medium, color: palette.text }}>
              {host}
            </Text>
            <FadeLabel
              text={trail}
              fontSize={font.body.fontSize}
              color={palette.secondary}
              fadeWidth={14}
              style={{ flex: 1, height: 18, marginLeft: -2 }}
            />
          </View>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text numberOfLines={1} ellipsizeMode="head" style={{ flexShrink: 0, maxWidth: "100%", ...font.body, fontWeight: weight.medium, color: palette.text }}>
              {host}
            </Text>
            {trail ? <Text numberOfLines={1} style={{ flexShrink: 1, ...font.body, color: palette.secondary }}>{trail}</Text> : null}
          </View>
        )}
      </Pressable>
      </ContextMenuArea>
      <View style={{ flexDirection: "row", alignItems: "center", paddingRight: 3 }}>
        {hovered && (
          <>
            <Button variant="icon" toolbar palette={palette} icon={bookmarked ? "bookmark.fill" : "bookmark"} size={13} box={24} radius={radius.m} onPress={toggleBookmark} tooltip={bookmarked ? "Remove Bookmark" : withShortcut("Bookmark This Page", bookmarkHint)} />
            {!inSplit && !sidebar && (
              <Button variant="icon" toolbar
                palette={palette}
                icon="rectangle.split.2x1"
                size={13}
                box={24}
                radius={radius.m}
                onPress={() => openSplitPane(windowId, { anchorTabId: tab.id })}
                tooltip={withShortcut("Open Split View", splitHint)}
              />
            )}
            <Button variant="icon" toolbar palette={palette} icon="slider.horizontal.3" size={13} box={24} radius={radius.m} onPress={toggleSiteControls} active={popover === "siteControls"} tooltip="Site Controls" />
          </>
        )}
        {capture && <CaptureIndicator camera={capture.camera} microphone={capture.microphone} screen={capture.screen} onPress={toggleSiteControls} />}
        <TranslateButton tabId={tab.id} palette={palette} onFocus={onFocus} />
        <ZoomIndicator tabId={tab.id} zoom={tab.zoom} palette={palette} onFocus={onFocus} />
        {popups > 0 && (
          <Button variant="icon" toolbar
            palette={palette}
            icon="macwindow.badge.plus"
            size={13}
            box={24}
            radius={radius.m}
            onPress={() => {
              onFocus();
              setPopover(tab.id, currentPopover(tab.id) === "popups" ? null : "popups");
            }}
            active={popover === "popups"}
            tooltip="Pop-ups blocked on this page"
          />
        )}
        {sidebar?.accessory}
      </View>
      {sidebar && sidebar.progress !== null ? <ProgressBar progress={sidebar.progress} color={theme.accent} /> : null}
    </View>
  );
});

function CaptureIndicator({ camera, microphone, screen, onPress }: { camera: boolean; microphone: boolean; screen: boolean; onPress: () => void }) {
  const theme = useTheme();
  const icon = screen ? "rectangle.inset.filled.on.rectangle" : camera ? "video.fill" : "mic.fill";
  const what = [camera && "camera", microphone && "microphone", screen && "screen"].filter(Boolean).join(" and ");
  return (
    <Pressable onPress={onPress} tooltip={`This page is using your ${what}`} style={{ width: 24, height: 24, alignItems: "center", justifyContent: "center" }}>
      <Symbol name={icon} size={12} color={theme.destructive} style={{ width: 18, height: 18 }} />
    </Pressable>
  );
}

const currentPopover = (tabId: string) => popoverOf(tabId) ?? null;

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
