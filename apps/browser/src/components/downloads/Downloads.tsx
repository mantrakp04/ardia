import { cancelDownload, keepDownload, pauseDownload, resumeDownload, type Download } from "../../state/downloads/actions";
import {
  ContextMenuArea,
  MouseArea,
  PopoverBubble,
  Symbol,
  Button,
  hex,
  HoverSlot,
  layout,
  MenuSeparator,
  PANEL,
  Text,
  useHover,
  usePopoverMotion,
  usePopoverMotionStyle,
  usePopoverPresence,
  useTheme,
} from "../ui";
import { copyText, fileExists, fileIcon, moveToTrash, openFile, revealFile, showMenu, type MenuItem } from "../../state/app/system";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { useDownloads, useSidebarOpen, useWindowId, useWindowUi } from "../../state/browser/hooks";
import { clearDownloads, removeDownload, setDownloadsOpen } from "../../state/windows/actions";
import { onDownloadsChanged, opensWhenDone, toggleOpenWhenDone, watchNewDownloads, watchOpenWhenDone } from "../../state/windows/downloadWatch";
import { useDownload } from "../../state/windows/hooks";
import { useAddressBarInSidebar, useTabLayout, useToolbarLightsCenter } from "../../state/windows/layout";
import { SIDEBAR_FOOTER_DOWNLOADS } from "../sidebar/geometry";
import { PROFILE_DOTS_HEIGHT } from "../profiles/ProfileDots";
import { openInternalPage } from "../../state/pages/urls";
import { useSidebarWidth } from "../sidebar/tokens";
import { hairline, shadow } from "../ui/tokens";
import { DOWNLOADS_PANEL, type DownloadsPlacement } from "./downloadsPlacement";
import { awaitsKeep, dangerWarning, downloadStatus } from "./downloadStatus";
import { FooterButton } from "./FooterButton";
import { useDownloadsPlacement } from "./useDownloadsPlacement";
import { DOWNLOADS_LIST as L, downloadsRowFill, FILE_ICON_GLYPH_SHARE, MAGNET, useDownloadsColors } from "./tokens";

export { awaitsKeep, downloadStatus } from "./downloadStatus";
export { DownloadsButton } from "./DownloadsButton";

const g = globalThis as { __acDownloadsWatch?: () => void };
g.__acDownloadsWatch?.();
g.__acDownloadsWatch = watchOpenWhenDone((path) => void openFile(path));

export async function downloadMenu(d: Download, windowId: string) {
  const exists = d.state === "finished" && fileExists(d.path);
  const items: MenuItem[] = awaitsKeep(d)
    ? [
        { id: "keep", title: "Keep" },
        { id: "cancel", title: "Discard" },
      ]
    : d.state === "downloading"
      ? [
          { id: "whenDone", title: "Open When Done", checked: opensWhenDone(d.id) },
          { id: d.paused ? "resume" : "pause", title: d.paused ? "Resume" : "Pause" },
          { id: "cancel", title: "Cancel" },
        ]
      : [
          { id: "open", title: "Open", enabled: exists },
          { id: "reveal", title: "Show in Finder", enabled: exists },
        ];
  items.push(
    { separator: true },
    { id: "copy", title: "Copy Download Link" },
    { id: "page", title: "Show All Downloads" },
    { separator: true },
    ...(exists ? [{ id: "trash", title: "Move to Trash" }] : []),
    { id: "remove", title: "Remove from List", enabled: d.state !== "downloading" },
  );
  const choice = await showMenu(items);
  if (choice === "whenDone") toggleOpenWhenDone(d.id);
  if (choice === "pause") void pauseDownload(d.id);
  if (choice === "resume") void resumeDownload(d.id);
  if (choice === "keep") void keepDownload(d.id);
  if (choice === "cancel") void cancelDownload(d.id);
  if (choice === "open") void openFile(d.path);
  if (choice === "reveal") void revealFile(d.path);
  if (choice === "copy") copyText(d.url);
  if (choice === "page") openInternalPage("downloads", windowId);
  if (choice === "trash") void trashDownload(d);
  if (choice === "remove") removeDownload(d.id);
}

async function trashDownload(d: Download) {
  if (await moveToTrash(d.path)) removeDownload(d.id);
}

const iconCache = new Map<string, string | null>();
export const FileIcon = memo(function FileIcon({ path, size = 28 }: { path: string; size?: number }) {
  const theme = useTheme();
  const key = `${path}@${size}`;
  const [uri, setUri] = useState(() => iconCache.get(key) ?? null);
  useEffect(() => {
    if (iconCache.has(key)) return setUri(iconCache.get(key) ?? null);
    let live = true;
    void fileIcon(path || "file.bin", size).then((u) => {
      iconCache.set(key, u);
      if (live) setUri(u);
    });
    return () => {
      live = false;
    };
  }, [key]);
  return uri ? (
    <Image source={{ uri }} style={{ width: size, height: size }} />
  ) : (
    <Symbol name="doc" size={size * FILE_ICON_GLYPH_SHARE} color={theme.icon} style={{ width: size, height: size }} />
  );
});

export function DownloadsPopover() {
  const windowId = useWindowId();
  const { shown, closing, onClosed } = usePopoverPresence(useWindowUi().downloadsOpen);
  return shown ? <DownloadsPanel windowId={windowId} closing={closing} onClosed={onClosed} /> : null;
}

function DownloadsPanel({ windowId, closing, onClosed }: { windowId: string; closing: boolean; onClosed: () => void }) {
  const liveIds = useDownloads(windowId, useShallow((list) => list.map((d) => d.id)));
  const liveClearable = useDownloads(windowId, (list) => list.some((d) => d.state !== "downloading"));
  const shownList = useRef({ ids: liveIds, clearable: liveClearable });
  if (!closing) shownList.current = { ids: liveIds, clearable: liveClearable };
  const { ids, clearable } = shownList.current;
  const topStrip = useTabLayout() === "top";
  const addressBar = useAddressBarInSidebar();
  const setOpen = (value: boolean) => setDownloadsOpen(windowId, value);
  const { root, placement: p, onLayout } = useDownloadsPlacement(windowId, closing, { topStrip, footer: addressBar, footerBottom: PROFILE_DOTS_HEIGHT + 2 });
  const placed = p !== null;
  const appear = usePopoverMotion(closing, onClosed, placed);

  const upward = p?.bottom !== undefined;
  const arrowX = p?.arrowX;
  const origin = useMemo(() => (arrowX === undefined ? "top" : ([arrowX, upward ? "100%" : 0, 0] as [number, string | number, number])), [arrowX, upward]);
  const motion = usePopoverMotionStyle(appear, origin, upward);
  const arrowRoom = p && p.arrow !== "none" ? DOWNLOADS_PANEL.arrowHeight : 0;
  const listMax = p ? Math.max(L.row, Math.min(L.visibleRows * L.row, p.room - L.chrome)) : L.visibleRows * L.row;

  return (
    <View ref={root} collapsable={false} onLayout={onLayout} pointerEvents={closing ? "none" : "auto"} style={StyleSheet.absoluteFill}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
      {p ? (
        <Animated.View
          style={{
            position: "absolute",
            left: p.left,
            ...(upward ? { bottom: p.bottom } : { top: p.top }),
            width: p.width,
            ...motion,
          }}
        >
          <PanelBackground placement={p} />
          <View style={{ marginTop: upward ? 0 : arrowRoom, marginBottom: upward ? arrowRoom : 0, paddingTop: L.padTop, paddingBottom: L.padBottom }}>
            <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: PANEL.inset, paddingRight: PANEL.inset - L.textButtonPad, height: L.header }}>
              <Text size="caption" weight="semibold" tone="textSecondary" style={{ flex: 1, letterSpacing: L.headerTracking }}>
                RECENT DOWNLOADS
              </Text>
              {clearable && (
                <Button
                  variant="text"
                  plate="hover"
                  height={L.clearHeight}
                  pad="sm"
                  weight="regular"
                  tone="textSecondary"
                  title="Clear"
                  onPress={() => {
                    setOpen(false);
                    clearDownloads(windowId);
                  }}
                />
              )}
            </View>
            {ids.length === 0 ? (
              <View style={{ height: PANEL.rowHeight, paddingHorizontal: PANEL.inset, justifyContent: "center" }}>
                <Text tone="textSecondary">No downloads yet</Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: listMax }} contentContainerStyle={{ paddingHorizontal: PANEL.rowInset }}>
                {ids.map((id) => (
                  <DownloadRowItem key={id} id={id} windowId={windowId} />
                ))}
              </ScrollView>
            )}
            <MenuSeparator />
            <FooterButton
              title="View all downloads"
              onPress={() => {
                setOpen(false);
                openInternalPage("downloads", windowId);
              }}
            />
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

function PanelBackground({ placement }: { placement: DownloadsPlacement }) {
  const theme = useTheme();
  const colors = useDownloadsColors();
  const level = shadow.popover;
  return (
    <PopoverBubble
      material="popover"
      dark={theme.dark}
      cornerRadius={PANEL.radius}
      arrowEdge={placement.arrow}
      arrowX={placement.arrowX}
      arrowWidth={DOWNLOADS_PANEL.arrowWidth}
      arrowHeight={DOWNLOADS_PANEL.arrowHeight}
      tint={hex(colors.bubbleTint)}
      edgeColor={hex(theme.popoverBorder)}
      edgeWidth={hairline.panel}
      shadowOpacity={theme.dark ? level.opacity.dark : level.opacity.light}
      shadowRadius={level.radius}
      shadowOffsetY={level.offset[1]}
      style={StyleSheet.absoluteFill}
    />
  );
}

function RowButton({ icon, onPress, tooltip }: { icon: string; onPress: () => void; tooltip: string }) {
  return <Button variant="icon" icon={icon} size={PANEL.iconSize} box={L.rowButton} radius={L.rowButtonRadius} onPress={onPress} tooltip={tooltip} />;
}

const DownloadRowItem = memo(function DownloadRowItem({ id, windowId }: { id: string; windowId: string }) {
  const live = useDownload(id);
  const last = useRef(live);
  if (live) last.current = live;
  return last.current ? <DownloadRow d={last.current} windowId={windowId} /> : null;
});

function DownloadRow({ d, windowId }: { d: Download; windowId: string }) {
  const theme = useTheme();
  const colors = useDownloadsColors();
  const { hovered, hoverProps } = useHover();
  const exists = d.state !== "finished" || fileExists(d.path);
  const shown = useRef(exists);
  shown.current = exists;
  const [, recheck] = useState(0);
  const finishedPath = d.state === "finished" ? d.path : null;
  useEffect(() => {
    if (finishedPath === null) return;
    const check = () => {
      if (fileExists(finishedPath) !== shown.current) recheck((n) => n + 1);
    };
    check();
    return onDownloadsChanged(check);
  }, [finishedPath]);
  const progress = d.total > 0 ? d.received / d.total : 0;
  const done = d.state === "finished" && exists;
  const blocked = awaitsKeep(d);
  return (
    <View {...hoverProps}>
      <MouseArea path={done ? d.path : null}>
        <ContextMenuArea onContextMenu={() => void downloadMenu(d, windowId)}>
          <Pressable onPress={() => done && void openFile(d.path)}>
            {({ pressed }) => (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: PANEL.iconGap,
                  paddingHorizontal: PANEL.rowPadding,
                  height: L.row,
                  borderRadius: PANEL.rowRadius,
                  backgroundColor: downloadsRowFill(theme, hovered, pressed && done),
                }}
              >
                <View style={{ opacity: exists ? 1 : L.missingOpacity }}>
                  <FileIcon path={d.path || d.filename} size={L.fileIcon} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    lines={1}
                    tone={exists ? "textPrimary" : "textSecondary"}
                    style={{ lineHeight: PANEL.titleLine, textDecorationLine: exists ? "none" : "line-through" }}
                  >
                    {d.filename || "Preparing…"}
                  </Text>
                  {d.state === "downloading" && !blocked ? (
                    <View style={{ height: L.progressHeight, borderRadius: L.progressRadius, marginTop: L.progressAbove, marginBottom: L.progressBelow, backgroundColor: colors.progressTrack }}>
                      <View
                        style={{ width: `${Math.max(progress, L.progressMin) * 100}%`, height: L.progressHeight, borderRadius: L.progressRadius, backgroundColor: d.paused ? theme.textTertiary : theme.accent }}
                      />
                    </View>
                  ) : null}
                  <Text lines={1} size="caption" tone={blocked ? "destructive" : "textSecondary"} style={{ lineHeight: PANEL.subtitleLine }}>
                    {blocked ? dangerWarning(d, true) : downloadStatus(d, exists)}
                  </Text>
                </View>
                {blocked ? (
                  <View style={{ flexDirection: "row", marginRight: -L.textButtonPad }}>
                    <Button variant="text" plate="hover" height={L.clearHeight} pad="sm" weight="regular" tone="textSecondary" title="Keep" onPress={() => void keepDownload(d.id)} />
                    <Button variant="text" plate="hover" height={L.clearHeight} pad="sm" title="Discard" onPress={() => void cancelDownload(d.id)} />
                  </View>
                ) : d.state === "downloading" ? (
                  <View style={{ flexDirection: "row", marginRight: -L.rowButtonBearing }}>
                    <RowButton
                      icon={d.paused ? "play.circle.fill" : "pause.circle.fill"}
                      onPress={() => void (d.paused ? resumeDownload(d.id) : pauseDownload(d.id))}
                      tooltip={d.paused ? "Resume" : "Pause"}
                    />
                    <RowButton icon="xmark.circle.fill" onPress={() => void cancelDownload(d.id)} tooltip="Cancel" />
                  </View>
                ) : done ? (
                  <HoverSlot
                    hovered={hovered}
                    width={L.rowButton}
                    style={{ marginRight: -L.rowButtonBearing }}
                    hover={<RowButton icon="magnifyingglass.circle.fill" onPress={() => void revealFile(d.path)} tooltip="Show in Finder" />}
                  />
                ) : null}
              </View>
            )}
          </Pressable>
        </ContextMenuArea>
      </MouseArea>
    </View>
  );
}

export function DownloadMagnet() {
  const windowId = useWindowId();
  const sidebarOpen = useSidebarOpen();
  const sidebarWidth = useSidebarWidth(windowId);
  const topStrip = useTabLayout() === "top";
  const addressBar = useAddressBarInSidebar();
  const lightsY = useToolbarLightsCenter()[1];
  const [flight, setFlight] = useState<{ id: string; path: string } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    return watchNewDownloads(windowId, (fresh) => {
      t.setValue(0);
      setFlight({ id: fresh.id, path: fresh.path || fresh.filename });
      Animated.timing(t, { toValue: 1, ...MAGNET.flight, useNativeDriver: true }).start(({ finished }) => finished && setFlight(null));
    });
  }, [windowId]);

  const sidebar = !topStrip && sidebarOpen ? sidebarWidth : 0;
  const footer = { x: layout.sidebarInset + SIDEBAR_FOOTER_DOWNLOADS.size / 2, y: size.height - SIDEBAR_FOOTER_DOWNLOADS.bottom - SIDEBAR_FOOTER_DOWNLOADS.size / 2 };
  const target = topStrip
    ? { x: size.width - MAGNET.topStripTarget.right, y: MAGNET.topStripTarget.y }
    : addressBar
      ? footer
      : sidebarOpen
        ? { x: sidebarWidth - MAGNET.sidebarTarget.right, y: lightsY }
        : MAGNET.closedTarget;
  const start = { x: sidebar + (size.width - sidebar) / 2, y: size.height * MAGNET.startShare };
  const icon = MAGNET.icon;
  const steps = [0, 0.25, 0.5, 0.75, 1];
  const x = t.interpolate({ inputRange: steps, outputRange: steps.map((p) => start.x + (target.x - start.x) * p - icon / 2) });
  const y = t.interpolate({ inputRange: steps, outputRange: steps.map((p) => start.y + (target.y - start.y) * p - Math.sin(Math.PI * p) * MAGNET.arc - icon / 2) });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e) => setSize(e.nativeEvent.layout)}>
      {flight && (
        <Animated.View
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: icon,
            height: icon,
            opacity: t.interpolate({ inputRange: [0, 0.1, 0.8, 1], outputRange: [0, 1, 1, 0] }),
            transform: [{ translateX: x }, { translateY: y }, { scale: t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.6, 1.1, 0.3] }) }],
          }}
        >
          <FileIcon path={flight.path} size={icon} />
        </Animated.View>
      )}
    </View>
  );
}
