import { cancelDownload, pauseDownload, resumeDownload, type Download } from "@ardia/ardiacore";
import { ContextMenuArea, copyText, fileExists, fileIcon, MouseArea, moveToTrash, openFile, revealFile, showMenu, Surface, Symbol, VisualEffect, type MenuItem } from "@ardia/shell";
import { memo, useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { hex, layout, useTheme } from "../lib/theme";
import { useShallow } from "zustand/react/shallow";
import { useBrowser } from "../store/browser";
import { useSidebarOpen, useWindowId, useWindowUi } from "../store/hooks";
import { downloadsIn, downloadVisibleIn } from "../store/ui";
import { SIDEBAR_FOOTER_DOWNLOADS, useAddressBarInSidebar, useSidebarOnRight, useTabLayout } from "./layout/windowLayout";
import { useFullscreenTab } from "./layout/pageState";
import { PROFILE_DOTS_HEIGHT } from "./profiles/ProfileDots";
import { openInternalPage } from "./pages/urls";
import { useSidebarWidth } from "./sidebar/tokens";
import { HoverSlot } from "./HoverSlot";
import { PANEL, POPOVER_MOTION, PopoverSeparator, usePopoverPresence } from "./layout/controls";
import { IconButton, useHover } from "./primitives";

function formatBytes(n: number) {
  if (n < 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} sec left`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min left`;
  return `${Math.round(seconds / 3600)} hr left`;
}

export function downloadStatus(d: Download, exists = true) {
  if (d.state === "finished") return exists ? formatBytes(d.total > 0 ? d.total : d.received) : "Deleted";
  if (d.state === "failed") return "Failed to Download";
  if (d.state === "cancelled") return "Cancelled";
  const progress = d.total > 0 ? `${formatBytes(d.received)} of ${formatBytes(d.total)}` : formatBytes(d.received);
  if (d.paused) return `${progress} — Paused`;
  if (d.speed > 0 && d.total > 0) return `${progress}, ${formatBytes(d.speed)}/s — ${formatDuration((d.total - d.received) / d.speed)}`;
  return progress;
}

const openWhenDone = new Set<string>();

const g = globalThis as { __acDownloadsWatch?: () => void };
g.__acDownloadsWatch?.();
g.__acDownloadsWatch = useBrowser.subscribe((s, prev) => {
  if (s.downloads === prev.downloads || !openWhenDone.size) return;
  for (const d of s.downloads) {
    if (d.state !== "downloading" && openWhenDone.delete(d.id) && d.state === "finished") void openFile(d.path);
  }
});

function toggleOpenWhenDone(id: string) {
  if (openWhenDone.has(id)) openWhenDone.delete(id);
  else openWhenDone.add(id);
}

export async function downloadMenu(d: Download, windowId: string) {
  const exists = d.state === "finished" && fileExists(d.path);
  const items: MenuItem[] =
    d.state === "downloading"
      ? [
          { id: "whenDone", title: "Open When Done", checked: openWhenDone.has(d.id) },
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
  if (choice === "cancel") void cancelDownload(d.id);
  if (choice === "open") void openFile(d.path);
  if (choice === "reveal") void revealFile(d.path);
  if (choice === "copy") copyText(d.url);
  if (choice === "page") openInternalPage("downloads", windowId);
  if (choice === "trash") void trashDownload(d);
  if (choice === "remove") useBrowser.getState().removeDownload(d.id);
}

async function trashDownload(d: Download) {
  if (await moveToTrash(d.path)) useBrowser.getState().removeDownload(d.id);
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
    <Symbol name="doc" size={size * 0.62} color={theme.icon} style={{ width: size, height: size }} />
  );
});

const WIDTH = 300;
const HEADER = 24;
const ROW = 40;
const FILE_ICON = 24;
const ROW_BUTTON = 22;
const ROW_BUTTON_BEARING = (ROW_BUTTON - PANEL.iconSize) / 2;
const VISIBLE_ROWS = 8;
const TEXT_BUTTON_PAD = 7;
const INK_INSET = PANEL.inset + 1;
const HEADER_CAP_TOP = 7.5;
const FOOTER_TEXT_DROP = 12;
const CHEVRON_BEARING = 3;

function rowFill(dark: boolean, hovered: boolean, pressed: boolean) {
  if (!hovered && !pressed) return undefined;
  return dark ? `rgba(255,255,255,${pressed ? 0.12 : 0.07})` : `rgba(0,0,0,${pressed ? 0.1 : 0.06})`;
}

const progressTrack = (dark: boolean) => (dark ? "#717782" : "#CED7E7");

export function DownloadsPopover() {
  const windowId = useWindowId();
  const { shown, closing, onClosed } = usePopoverPresence(useWindowUi().downloadsOpen);
  return shown ? <DownloadsPanel windowId={windowId} closing={closing} onClosed={onClosed} /> : null;
}

function DownloadsPanel({ windowId, closing, onClosed }: { windowId: string; closing: boolean; onClosed: () => void }) {
  const theme = useTheme();
  const liveIds = useBrowser(useShallow((s) => downloadsIn(s, windowId).map((d) => d.id)));
  const liveClearable = useBrowser((s) => downloadsIn(s, windowId).some((d) => d.state !== "downloading"));
  const shownList = useRef({ ids: liveIds, clearable: liveClearable });
  if (!closing) shownList.current = { ids: liveIds, clearable: liveClearable };
  const { ids, clearable } = shownList.current;
  const top = useTabLayout() === "top";
  const addressBar = useAddressBarInSidebar();
  const end = useSidebarOnRight() || top;
  const setOpen = (value: boolean) => useBrowser.getState().setDownloadsOpen(windowId, value);
  const appear = useRef(new Animated.Value(0)).current;
  const closed = useRef(onClosed);
  closed.current = onClosed;
  useEffect(() => {
    const motion = closing ? POPOVER_MOTION.close : POPOVER_MOTION.open;
    Animated.timing(appear, { toValue: closing ? 0 : 1, duration: motion.duration, easing: motion.easing, useNativeDriver: true }).start(
      ({ finished }) => finished && closing && closed.current(),
    );
  }, [closing]);

  return (
    <View pointerEvents={closing ? "none" : "auto"} style={StyleSheet.absoluteFill}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
      <Animated.View
        style={{
          position: "absolute",
          ...(addressBar ? { bottom: PROFILE_DOTS_HEIGHT + 2 } : { top: 44 }),
          ...(top ? { right: 8 } : end ? { right: 10 } : { left: 10 }),
          opacity: appear,
          transformOrigin: `${addressBar ? "bottom" : "top"} ${end ? "right" : "left"}`,
          transform: [
            { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
            { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: addressBar ? [4, 0] : [-4, 0] }) },
          ],
        }}
      >
        <Surface
          fill={hex(theme.dark ? "rgba(38,36,37,0.94)" : "rgba(252,251,252,0.96)")}
          cornerRadius={PANEL.radius}
          borderColor={hex(theme.dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)")}
          borderWidth={0.5}
          shadowColor="#000000"
          shadowOpacity={theme.dark ? 0.45 : 0.16}
          shadowRadius={18}
          shadowOffset={[0, 8]}
          style={{ width: WIDTH, paddingTop: INK_INSET - HEADER_CAP_TOP, paddingBottom: INK_INSET - FOOTER_TEXT_DROP }}
        >
          <VisualEffect material="menu" cornerRadius={PANEL.radius} style={StyleSheet.absoluteFill} />
          <View style={{ ...StyleSheet.absoluteFillObject, borderRadius: PANEL.radius, backgroundColor: theme.dark ? "rgba(38,36,37,0.72)" : "rgba(252,251,252,0.7)" }} />
          <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: PANEL.inset, paddingRight: PANEL.inset - TEXT_BUTTON_PAD, height: HEADER }}>
            <Text style={{ flex: 1, fontSize: PANEL.subtitleSize, fontWeight: "600", letterSpacing: 0.4, color: theme.textSecondary }}>
              RECENT DOWNLOADS
            </Text>
            {clearable && (
              <TextButton
                title="Clear"
                onPress={() => {
                  setOpen(false);
                  useBrowser.getState().clearDownloads(windowId);
                }}
              />
            )}
          </View>
          {ids.length === 0 ? (
            <View style={{ height: PANEL.rowHeight, paddingHorizontal: PANEL.inset, justifyContent: "center" }}>
              <Text style={{ fontSize: PANEL.titleSize, color: theme.textSecondary }}>No downloads yet</Text>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: VISIBLE_ROWS * ROW }} contentContainerStyle={{ paddingHorizontal: PANEL.rowInset }}>
              {ids.map((id) => (
                <DownloadRowItem key={id} id={id} windowId={windowId} />
              ))}
            </ScrollView>
          )}
          <PopoverSeparator />
          <FooterButton
            title="View all downloads"
            onPress={() => {
              setOpen(false);
              openInternalPage("downloads", windowId);
            }}
          />
        </Surface>
      </Animated.View>
    </View>
  );
}

function TextButton({ title, onPress }: { title: string; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress}>
        <View style={{ height: 22, paddingHorizontal: TEXT_BUTTON_PAD, borderRadius: 6, justifyContent: "center", backgroundColor: hovered ? theme.toolbarHover : undefined }}>
          <Text style={{ fontSize: 12, color: theme.textSecondary }}>{title}</Text>
        </View>
      </Pressable>
    </View>
  );
}

function FooterButton({ title, onPress }: { title: string; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} style={{ paddingHorizontal: PANEL.rowInset }}>
      <Pressable onPress={onPress}>
        {({ pressed }) => (
          <View
            style={{
              height: PANEL.rowHeight,
              paddingHorizontal: PANEL.rowPadding,
              borderRadius: PANEL.rowRadius,
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: rowFill(theme.dark, hovered, pressed),
            }}
          >
            <Text style={{ flex: 1, fontSize: PANEL.titleSize, color: hovered ? theme.textPrimary : theme.textSecondary }}>{title}</Text>
            <Symbol name="chevron.right" size={9} weight="semibold" color={theme.textTertiary} style={{ width: 12, height: 12, marginRight: -CHEVRON_BEARING }} />
          </View>
        )}
      </Pressable>
    </View>
  );
}

function RowButton({ icon, onPress, tooltip }: { icon: string; onPress: () => void; tooltip: string }) {
  return <IconButton icon={icon} size={PANEL.iconSize} box={ROW_BUTTON} radius={6} onPress={onPress} tooltip={tooltip} />;
}

const DownloadRowItem = memo(function DownloadRowItem({ id, windowId }: { id: string; windowId: string }) {
  const live = useBrowser((s) => s.downloads.find((x) => x.id === id));
  const last = useRef(live);
  if (live) last.current = live;
  return last.current ? <DownloadRow d={last.current} windowId={windowId} /> : null;
});

function DownloadRow({ d, windowId }: { d: Download; windowId: string }) {
  const theme = useTheme();
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
    return useBrowser.subscribe((s, prev) => {
      if (s.downloads !== prev.downloads) check();
    });
  }, [finishedPath]);
  const progress = d.total > 0 ? d.received / d.total : 0;
  const done = d.state === "finished" && exists;
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
                  height: ROW,
                  borderRadius: PANEL.rowRadius,
                  backgroundColor: rowFill(theme.dark, hovered, pressed && done),
                }}
              >
                <View style={{ opacity: exists ? 1 : 0.45 }}>
                  <FileIcon path={d.path || d.filename} size={FILE_ICON} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      fontSize: PANEL.titleSize,
                      lineHeight: PANEL.titleLine,
                      color: exists ? theme.textPrimary : theme.textSecondary,
                      textDecorationLine: exists ? "none" : "line-through",
                    }}
                  >
                    {d.filename || "Preparing…"}
                  </Text>
                  {d.state === "downloading" ? (
                    <View style={{ height: 3, borderRadius: 1.5, marginTop: 3, marginBottom: 2, backgroundColor: progressTrack(theme.dark) }}>
                      <View
                        style={{ width: `${Math.max(progress, 0.03) * 100}%`, height: 3, borderRadius: 1.5, backgroundColor: d.paused ? theme.textTertiary : theme.accent }}
                      />
                    </View>
                  ) : null}
                  <Text numberOfLines={1} style={{ fontSize: PANEL.subtitleSize, lineHeight: PANEL.subtitleLine, color: theme.textSecondary }}>
                    {downloadStatus(d, exists)}
                  </Text>
                </View>
                {d.state === "downloading" ? (
                  <View style={{ flexDirection: "row", marginRight: -ROW_BUTTON_BEARING }}>
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
                    width={ROW_BUTTON}
                    style={{ marginRight: -ROW_BUTTON_BEARING }}
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
  const right = useSidebarOnRight();
  const fullscreen = !!useFullscreenTab(windowId);
  const [flight, setFlight] = useState<{ id: string; path: string } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const t = useRef(new Animated.Value(0)).current;
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    seen.current = new Set(useBrowser.getState().downloads.map((d) => d.id));
    return useBrowser.subscribe((s, prev) => {
      if (s.downloads === prev.downloads) return;
      const fresh = s.downloads.find((d) => !seen.current!.has(d.id));
      s.downloads.forEach((d) => seen.current!.add(d.id));
      if (!fresh || s.ui.focusedWindowId !== windowId || !downloadVisibleIn(fresh, s.windows[windowId])) return;
      t.setValue(0);
      setFlight({ id: fresh.id, path: fresh.path || fresh.filename });
      Animated.timing(t, { toValue: 1, duration: 700, easing: Easing.bezier(0.45, 0, 0.2, 1), useNativeDriver: true }).start(({ finished }) => finished && setFlight(null));
    });
  }, [windowId]);

  const sidebar = !topStrip && sidebarOpen && !fullscreen ? sidebarWidth : 0;
  const footer = { x: layout.sidebarInset + SIDEBAR_FOOTER_DOWNLOADS.size / 2, y: size.height - SIDEBAR_FOOTER_DOWNLOADS.bottom - SIDEBAR_FOOTER_DOWNLOADS.size / 2 };
  const target = topStrip ? { x: size.width - 25, y: 21 } : addressBar ? footer : sidebarOpen ? { x: sidebarWidth - 24, y: 27 } : { x: 24, y: 24 };
  if (right) target.x = size.width - target.x;
  const start = { x: (right ? 0 : sidebar) + (size.width - sidebar) / 2, y: size.height * 0.45 };
  const icon = 44;
  const steps = [0, 0.25, 0.5, 0.75, 1];
  const x = t.interpolate({ inputRange: steps, outputRange: steps.map((p) => start.x + (target.x - start.x) * p - icon / 2) });
  const y = t.interpolate({ inputRange: steps, outputRange: steps.map((p) => start.y + (target.y - start.y) * p - Math.sin(Math.PI * p) * 90 - icon / 2) });

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
