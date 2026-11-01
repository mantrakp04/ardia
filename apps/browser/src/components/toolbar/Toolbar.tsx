import { pageHostLabel, urlTrail } from "../../lib/url";
import { memo, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { Animated, Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { useTheme } from "../ui/theme";
import { TOOLBAR_ROWS, urlFieldOf, type ToolbarRow } from "../../lib/toolbarRow";
import { ToolbarRowContext } from "../ui/toolbarRowContext";
import { activate } from "../../state/tabs/actions";
import { openPanel as openWindowPanel, toggleSidebar } from "../../state/windows/actions";
import { useIsBookmarked, useSettings, useTab, useTabLive } from "../../state/browser/hooks";
import type { Tab } from "../../state/browser/types";
import { Button, ContextMenuArea, Divider, FadeLabel, font, ink, space, Symbol, Text, useHover, WindowDragRegion } from "../ui";
import { type ToolbarGeometry } from "../window/geometry";
import { popoverOf, setPopover, usePage, usePages, type PageState } from "../../state/tabs/pageState";
import { useHistoryAvailability } from "../../state/tabs/navigation";
import { toggleBookmarkOfTab } from "../../state/bookmarks/actions";
import { closePane, openSplitPane, showSplitMenu } from "../../state/splits/actions";
import { useEasedColor, type ToolbarPalette } from "../ui/toolbarColors";
import { useSitePalette } from "./useSitePalette";
import { setToolbarExtensionsWidth } from "../../state/windows/layout";
import { SIDEBAR_FIELD } from "../sidebar/geometry";
import { FieldSiteButton, SidebarFieldFill } from "../sidebar/SidebarField";
import { showUrlBarMenu } from "../../state/omnibox/paste";
import { ToolbarExtensions, useToolbarExtensionsWidth } from "../extensions/ToolbarExtensions";
import { GlassFill, useGlass } from "../ui/Glass";
import { TranslateButton } from "../site/TranslateControls";
import { ZoomIndicator } from "../site/ZoomControls";
import { useShortcutHint, withShortcut } from "../../state/commands/commandShortcuts";
import { curve } from "../ui/motion";
import { HistoryButton, ReloadButton } from "./NavButtons";
import { ProgressBar, TabProgressBar } from "./ProgressBar";
import { TOOLBAR_MOTION } from "./tokens";
import { useToolbarRow } from "./useToolbarRow";

type ToolbarTab = Pick<Tab, "id" | "url" | "title" | "windowId" | "zoom">;
const toolbarTab = (t: Tab | undefined): ToolbarTab | undefined =>
  t && { id: t.id, url: t.url, title: isWebUrl(t.url) ? "" : t.title, windowId: t.windowId, zoom: t.zoom };
const isWebUrl = (url: string) => /^https?:/i.test(url);
export const useToolbarTab = (tabId: string | undefined) => useTab(tabId, useShallow(toolbarTab));

export const urlFieldRight = (inSplit: boolean, extensionsWidth: number, row: ToolbarRow) => (inSplit ? 12 + 2 * (row.button - 2) : 12) + extensionsWidth;
const LOCK = { left: 7, width: 18, gap: space.xs } as const;
const SIDEBAR_TEXT_GAP = 6;
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
  const palette = useSitePalette(tabId);
  const band = useEasedColor(bare ? null : palette.background);
  const history = useHistoryAvailability(tabId);
  const row = useToolbarRow();
  const extensionsWidth = useToolbarExtensionsWidth(windowId, Infinity);
  useEffect(() => setToolbarExtensionsWidth(windowId, extensionsWidth), [windowId, extensionsWidth]);
  const dim = useRef(new Animated.Value(focused ? 1 : 0.5)).current;
  const dimmedFor = useRef(focused);
  useEffect(() => {
    if (dimmedFor.current === focused) return;
    dimmedFor.current = focused;
    Animated.timing(dim, { toValue: focused ? 1 : 0.5, duration: TOOLBAR_MOTION.dim, easing: curve.enter, useNativeDriver: true }).start();
  }, [focused]);
  const focus = useCallback(() => {
    if (!focused) activate(tabId);
  }, [focused, tabId]);
  const at = useMemo(() => {
    const top = row.center - row.button / 2;
    const place = (center: number | null) => ({ position: "absolute" as const, top, left: (center ?? 0) - row.button / 2 });
    const hit = { width: row.button, height: row.button, plateX: 0, plateY: 0, box: row.button, radius: row.buttonRadius };
    const nav = (center: number | null) => ({ style: place(center), hit });
    return { top, sidebarButton: place(geometry.sidebarButton), back: nav(geometry.back), forward: nav(geometry.forward), reload: nav(geometry.reload) };
  }, [geometry, row]);
  const right = urlFieldRight(inSplit, extensionsWidth, row);
  const urlStyle = useMemo(() => ({ position: "absolute" as const, left: geometry.urlLeft, right, top: urlFieldOf(row).top }), [geometry.urlLeft, right, row]);
  if (!tab) return <View style={{ height: row.height }} />;

  return (
    <View style={{ height: row.height }}>
      {!bare && <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: band }]} />}
      <WindowDragRegion style={StyleSheet.absoluteFill} />
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: dim }]} pointerEvents="box-none">
        {geometry.sidebarButton !== null && (
          <Button variant="icon" toolbar
            style={at.sidebarButton}
            palette={palette}
            icon="sidebar.left"
            look="row"
            onPress={() => toggleSidebar(windowId)}
            tooltip={withShortcut("Auto-Hide Tabs", sidebarHint)}
          />
        )}
        <HistoryButton place={at.back} tabId={tab.id} windowId={tab.windowId} direction={-1} disabled={!history.back} palette={palette} onFocus={focus} />
        <HistoryButton place={at.forward} tabId={tab.id} windowId={tab.windowId} direction={1} disabled={!history.forward} palette={palette} onFocus={focus} />
        <ReloadButton place={at.reload} tab={tab} loading={isLoading} palette={palette} onFocus={focus} />
        <ToolbarExtensions tabId={tab.id} windowId={windowId} palette={palette} top={row.center - row.extensionButton / 2} right={inSplit ? 8 + 2 * row.button : 8} />
        {tab.url ? (
          <ToolbarUrlField tab={tab} palette={palette} windowId={windowId} inSplit={inSplit} onFocus={focus} style={urlStyle} />
        ) : null}
        {inSplit && (
          <View style={{ position: "absolute", top: at.top, right: 8, flexDirection: "row", gap: -space.xxs }}>
            <Button variant="icon" toolbar palette={palette} icon="rectangle.split.2x1" look="row" onPress={() => showSplitMenu(tab.id)} tooltip="Split View" />
            <Button variant="icon" toolbar palette={palette} icon="xmark" look="row" weight="medium" onPress={() => closePane(tab.id)} tooltip="Close Pane" />
          </View>
        )}
      </Animated.View>

      {tab.url && !bare ? <Divider color={palette.divider} style={BOTTOM_LINE} /> : null}
      {isLoading && <TabProgressBar key={tabId} tabId={tabId} color={palette.background ? palette.icon : theme.accent} />}
    </View>
  );
}

const BOTTOM_LINE = { position: "absolute", left: 0, right: 0, bottom: 0 } as const;

export function ToolbarBackdrop({ tabId }: { tabId: string }) {
  const url = useTab(tabId, (t) => t?.url ?? "");
  const palette = useSitePalette(tabId);
  const band = useEasedColor(palette.background);
  const row = useToolbarRow();
  return (
    <View pointerEvents="none" style={{ height: row.height }}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: band }]} />
      {url ? <Divider color={palette.divider} style={BOTTOM_LINE} /> : null}
    </View>
  );
}

function useUrlField(tab: ToolbarTab, windowId: string, onFocus: () => void) {
  const showFullUrl = useSettings((s) => s.showFullUrl);
  const insecure = usePage(tab.id, insecureLevel);
  const popover = usePages((p) => p.popover[tab.id] ?? null);
  const { hovered: pointerOver, hoverProps } = useHover();
  const hovered = pointerOver || popover === "siteControls";
  const openPanel = () => {
    onFocus();
    openWindowPanel(windowId, tab.url);
  };
  const toggleSiteControls = () => {
    onFocus();
    setPopover(tab.id, currentPopover(tab.id) === "siteControls" ? null : "siteControls");
  };
  return { insecure, popover, hovered, hoverProps, openPanel, toggleSiteControls, host: pageHostLabel(tab.url), trail: urlTrail(tab.url, tab.title, { hovered, showFullUrl }) };
}

type UrlFieldProps = { tab: ToolbarTab; palette: ToolbarPalette; windowId: string; onFocus: () => void };

export const ToolbarUrlField = memo(function ToolbarUrlField({ tab, palette, windowId, inSplit, onFocus, style }: UrlFieldProps & { inSplit: boolean; style: ViewStyle }) {
  const theme = useTheme();
  const row = useToolbarRow();
  const splitHint = useShortcutHint("openSplitPane");
  const field = useUrlField(tab, windowId, onFocus);
  const { insecure, hovered, popover, toggleSiteControls } = field;
  const glass = useGlass();

  return (
    <View {...field.hoverProps} style={[style, { flexDirection: "row", alignItems: "center", height: row.field, borderRadius: row.fieldRadius, backgroundColor: hovered && !glass ? palette.pill : undefined }]}>
      {glass ? (
        <GlassFill state={hovered ? "lit" : "rest"} radius={row.fieldRadius} dark={palette.background ? palette.text.startsWith(ink.white) : undefined} />
      ) : null}
      {insecure && (
        <Pressable onPress={toggleSiteControls} style={{ paddingLeft: LOCK.left }} tooltip="Connection is not secure">
          <Symbol
            name="lock.open.trianglebadge.exclamationmark.fill"
            size={12}
            color={insecure === "certificateError" ? theme.destructive : palette.secondary}
            style={{ width: LOCK.width, height: row.field }}
          />
        </Pressable>
      )}
      <ContextMenuArea style={{ flex: 1 }} onContextMenu={() => void showUrlBarMenu(tab)}>
        <Pressable onPress={field.openPanel} style={{ flex: 1, height: row.field, justifyContent: "center", paddingLeft: insecure ? LOCK.gap : urlTextLeft(false) }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text numberOfLines={1} ellipsizeMode="head" weight="medium" color={palette.text} style={HOST_FULL}>
              {field.host}
            </Text>
            {field.trail ? (
              <Text numberOfLines={1} color={palette.secondary} style={SHRINK}>
                {field.trail}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </ContextMenuArea>
      <FieldButtons tab={tab} palette={palette} onFocus={onFocus} popover={popover} toggleSiteControls={toggleSiteControls}>
        {hovered && (
          <>
            <BookmarkButton tab={tab} palette={palette} windowId={windowId} />
            {!inSplit && (
              <Button variant="icon" toolbar
                palette={palette}
                icon="rectangle.split.2x1"
                look="field"
                onPress={() => openSplitPane(windowId, { anchorTabId: tab.id })}
                tooltip={withShortcut("Open Split View", splitHint)}
              />
            )}
            <Button variant="icon" toolbar palette={palette} icon="slider.horizontal.3" look="field" onPress={toggleSiteControls} active={popover === "siteControls"} tooltip="Site Controls" />
          </>
        )}
      </FieldButtons>
    </View>
  );
});

export const SidebarUrlField = memo(function SidebarUrlField({ tab, palette, windowId, onFocus, height, progress, accessory }: UrlFieldProps & { height: number; progress: number | null; accessory: ReactNode }) {
  const theme = useTheme();
  const field = useUrlField(tab, windowId, onFocus);
  const { insecure, hovered, popover, toggleSiteControls } = field;

  return (
    <View {...field.hoverProps} style={{ flexDirection: "row", alignItems: "center", height, borderRadius: SIDEBAR_FIELD.radius }}>
      <SidebarFieldFill hovered={hovered} />
      <FieldSiteButton
        icon={insecure ? "lock.open.trianglebadge.exclamationmark.fill" : "slider.horizontal.3"}
        color={insecure === "certificateError" ? theme.destructive : undefined}
        tooltip={insecure ? "Connection is not secure" : "Site Controls"}
        active={popover === "siteControls"}
        palette={palette}
        onPress={toggleSiteControls}
      />
      <ContextMenuArea style={{ flex: 1 }} onContextMenu={() => void showUrlBarMenu(tab)}>
        <Pressable onPress={field.openPanel} style={{ flex: 1, height, justifyContent: "center", paddingLeft: SIDEBAR_TEXT_GAP }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text numberOfLines={1} ellipsizeMode="head" weight="medium" color={palette.text} style={SHRINK}>
              {field.host}
            </Text>
            <FadeLabel text={field.trail} fontSize={font.body.fontSize} color={palette.secondary} fadeWidth={14} style={{ flex: 1, height: 18, marginLeft: -space.xxs }} />
          </View>
        </Pressable>
      </ContextMenuArea>
      <ToolbarRowContext.Provider value={TOOLBAR_ROWS.regular}>
        <FieldButtons tab={tab} palette={palette} onFocus={onFocus} popover={popover} toggleSiteControls={toggleSiteControls} accessory={accessory}>
          {hovered && <BookmarkButton tab={tab} palette={palette} windowId={windowId} />}
        </FieldButtons>
      </ToolbarRowContext.Provider>
      {progress !== null ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: SIDEBAR_FIELD.radius, overflow: "hidden" }]}>
          <ProgressBar progress={progress} color={theme.accent} />
        </View>
      ) : null}
    </View>
  );
});

const HOST_FULL = { flexShrink: 0, maxWidth: "100%" } as const;
const SHRINK = { flexShrink: 1 } as const;

function BookmarkButton({ tab, palette, windowId }: { tab: ToolbarTab; palette: ToolbarPalette; windowId: string }) {
  const bookmarkHint = useShortcutHint("bookmarkPage");
  const bookmarked = useIsBookmarked(tab.url);
  return (
    <Button variant="icon" toolbar palette={palette} icon={bookmarked ? "bookmark.fill" : "bookmark"} look="field" onPress={() => toggleBookmarkOfTab(windowId, tab.id)} tooltip={bookmarked ? "Remove Bookmark" : withShortcut("Bookmark This Page", bookmarkHint)} />
  );
}

function FieldButtons({
  tab,
  palette,
  onFocus,
  popover,
  toggleSiteControls,
  accessory,
  children,
}: {
  tab: ToolbarTab;
  palette: ToolbarPalette;
  onFocus: () => void;
  popover: string | null;
  toggleSiteControls: () => void;
  accessory?: ReactNode;
  children: ReactNode;
}) {
  const popups = usePage(tab.id, (p) => p.popups.length);
  const capture = usePage(tab.id, (p) => p.mediaAccess);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingRight: space.xs }}>
      {children}
      {capture && <CaptureIndicator camera={capture.camera} microphone={capture.microphone} screen={capture.screen} onPress={toggleSiteControls} />}
      <TranslateButton tabId={tab.id} palette={palette} onFocus={onFocus} />
      <ZoomIndicator tabId={tab.id} zoom={tab.zoom} palette={palette} onFocus={onFocus} />
      {popups > 0 && (
        <Button variant="icon" toolbar
          palette={palette}
          icon="macwindow.badge.plus"
          look="field"
          onPress={() => {
            onFocus();
            setPopover(tab.id, currentPopover(tab.id) === "popups" ? null : "popups");
          }}
          active={popover === "popups"}
          tooltip="Pop-ups blocked on this page"
        />
      )}
      {accessory}
    </View>
  );
}

function CaptureIndicator({ camera, microphone, screen, onPress }: { camera: boolean; microphone: boolean; screen: boolean; onPress: () => void }) {
  const theme = useTheme();
  const icon = screen ? "rectangle.inset.filled.on.rectangle" : camera ? "video.fill" : "mic.fill";
  const what = [camera && "camera", microphone && "microphone", screen && "screen"].filter(Boolean).join(" and ");
  return <Button variant="icon" icon={icon} look="field" color={theme.destructive} onPress={onPress} tooltip={`This page is using your ${what}`} />;
}

const currentPopover = (tabId: string) => popoverOf(tabId) ?? null;
