import { ContextMenuArea, copyFile, copyText, fileExists, moveToTrash, openInPreview, revealFile, showMenu, Symbol, VisualEffect } from "@ardia/shell";
import type { Download } from "@ardia/ardiacore";
import { openUrl } from "../bookmarks/actions";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, findNodeHandle, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { claimFocusTag } from "../../lib/focusClaims";
import { fileUri } from "../../lib/fileUri";
import { ThemeScope, useTheme } from "../../lib/theme";
import { webviews } from "../../lib/webviews";
import { useBrowser } from "../../store/browser";
import { PageProfileContext, useWindowId } from "../../store/hooks";
import { activeTabId, viewTabIds } from "../../store/model";
import { cleanedTabsFor } from "../../store/organize";
import type { ClosedTab } from "../../store/types";
import { downloadsIn } from "../../store/ui";
import { DownloadCard } from "../pages/DownloadsPage";
import { ThemeTint } from "../theme/ThemeTint";
import { hostLabel, matchesQuery } from "../pages/PageLayout";
import { Favicon, IconButton, useHover } from "../primitives";
import { libraryReveal, useLibraryPull } from "./pull";
import { archivedFor, byDay, cleanedIn, closeLibrary, LIBRARY_FOCUS, openLibrary, useLibrary, type LibrarySection } from "./state";

const SOLID_AT = 0.3;
const RAIL = 112;
const SHEET_INSET = 14;
const SHEET_TOP = 40;
const COLUMN = 262;
const SPACE_GAP = 18;
const SECTIONS: { id: LibrarySection; title: string; icon: string }[] = [
  { id: "spaces", title: "Spaces", icon: "square.on.square" },
  { id: "archive", title: "Archived Tabs", icon: "archivebox" },
  { id: "downloads", title: "Downloads", icon: "arrow.down.circle" },
  { id: "media", title: "Media", icon: "photo.on.rectangle" },
];
const ARROW_KEYS = [{ key: "Escape" }, { key: "ArrowLeft" }, { key: "ArrowRight" }];
const ESCAPE_KEY = [{ key: "Escape" }];
const IMAGE = /\.(png|jpe?g|gif|webp|heic|avif|bmp|tiff?)$/i;
const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;

export function LibraryHost() {
  const windowId = useWindowId();
  const opened = useLibrary((s) => s.open[windowId]);
  const pulling = useLibraryPull((s) => !!s.pulling[windowId]);
  const section = opened ?? (pulling ? "spaces" : undefined);
  const [shown, setShown] = useState(section);
  const reveal = libraryReveal(windowId);
  const pagerPull = useLibraryPull((s) => s.sources[windowId]);
  const appear = useMemo(() => (pagerPull ? Animated.add(reveal, pagerPull).interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }) : reveal), [reveal, pagerPull]);
  useEffect(() => {
    if (pulling && !opened) {
      setShown("spaces");
      return;
    }
    if (section) {
      setShown(section);
      Animated.timing(reveal, { toValue: 1, duration: 280, easing: Easing.bezier(0.2, 0.9, 0.25, 1), useNativeDriver: true }).start();
      return;
    }
    Animated.timing(reveal, { toValue: 0, duration: 200, easing: Easing.bezier(0.4, 0, 0.7, 0.2), useNativeDriver: true }).start(({ finished }) => {
      if (finished) setShown(undefined);
    });
  }, [section, pulling]);
  return shown ? <Library windowId={windowId} section={section ?? shown} appear={appear} /> : null;
}

type LibraryHooks = { spaces: ((direction: 1 | -1) => void) | null; media: ((key: string) => boolean) | null };

function Library({ windowId, section, appear }: { windowId: string; section: LibrarySection; appear: Animated.Value | Animated.AnimatedInterpolation<number> }) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);
  const hooks = useRef<LibraryHooks>({ spaces: null, media: null }).current;
  const search = useRef<TextInput>(null);
  const sectionFade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    sectionFade.setValue(0);
    Animated.timing(sectionFade, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [section]);
  useEffect(() => {
    search.current?.focus();
    claimFocusTag(windowId, LIBRARY_FOCUS, () => findNodeHandle(search.current));
    return () => {
      const now = activeTabId(useBrowser.getState(), windowId);
      if (now) void webviews.get(now)?.focus();
    };
  }, []);
  useEffect(() => {
    setQuery("");
    setViewing(null);
  }, [section]);
  const arrows = (!query && (section === "spaces" || section === "media")) || (section === "media" && !!viewing);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: appear }]}>
        <Pressable onPress={() => closeLibrary(windowId)} style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.32)" }]} />
      </Animated.View>
    <Animated.View
      style={{
        position: "absolute",
        left: SHEET_INSET,
        right: SHEET_INSET,
        top: SHEET_TOP,
        bottom: SHEET_INSET,
        borderRadius: 16,
        overflow: "hidden",
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: theme.panelBorder,
        opacity: appear.interpolate({ inputRange: [0, SOLID_AT, 1], outputRange: [0, 1, 1], extrapolate: "clamp" }),
        transform: [
          { translateX: appear.interpolate({ inputRange: [0, 1], outputRange: [-220, 0] }) },
          { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1] }) },
        ],
      }}
    >
      <VisualEffect material="sidebar" blendingMode="withinWindow" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.dark ? "rgba(30,30,32,1)" : "rgba(244,242,240,1)" }]} />
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View style={{ width: RAIL, paddingTop: 56, alignItems: "center", gap: 6 }}>
          {SECTIONS.map((s) => (
            <RailButton key={s.id} title={s.title} icon={s.icon} selected={s.id === section} onPress={() => openLibrary(windowId, s.id)} />
          ))}
          <View style={{ flex: 1 }} />
          <RailButton title="Back" icon="arrow.left" selected={false} onPress={() => closeLibrary(windowId)} />
          <View style={{ height: 16 }} />
        </View>
        <View style={{ flex: 1, paddingTop: 28 }}>
          <View style={{ height: 40, flexDirection: "row", alignItems: "center", paddingRight: 24, gap: 12 }}>
            <Text style={{ fontSize: 22, fontWeight: "700", color: theme.textPrimary }}>{SECTIONS.find((s) => s.id === section)!.title}</Text>
            <View style={{ flex: 1 }} />
            <View style={{ width: 260, height: 30, borderRadius: 8, flexDirection: "row", alignItems: "center", paddingHorizontal: 9, gap: 6, backgroundColor: theme.dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" }}>
              <Symbol name="magnifyingglass" size={12} color={theme.textSecondary} style={{ width: 14, height: 14 }} />
              <TextInput
                ref={search}
                value={query}
                onChangeText={setQuery}
                placeholder={`Search ${SECTIONS.find((s) => s.id === section)!.title}`}
                placeholderTextColor={theme.placeholder}
                selectionColor={theme.selection}
                enableFocusRing={false}
                keyDownEvents={arrows ? ARROW_KEYS : ESCAPE_KEY}
                onKeyDown={(e) => {
                  const key = e.nativeEvent.key;
                  if (section === "media" && hooks.media?.(key)) return;
                  if (key === "ArrowLeft" || key === "ArrowRight") {
                    if (!query && section === "spaces") hooks.spaces?.(key === "ArrowRight" ? 1 : -1);
                    return;
                  }
                  if (key !== "Escape") return;
                  if (query) setQuery("");
                  else closeLibrary(windowId);
                }}
                style={{ flex: 1, fontSize: 13, color: theme.textPrimary, paddingVertical: 0 }}
              />
            </View>
          </View>
          <Animated.View style={{ flex: 1, marginTop: 14, opacity: sectionFade, transform: [{ translateY: sectionFade.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }}>
            {section === "spaces" && <SpacesSection windowId={windowId} query={query} hooks={hooks} />}
            {section === "archive" && <ArchiveSection windowId={windowId} query={query} />}
            {section === "downloads" && <DownloadsSection windowId={windowId} query={query} />}
            {section === "media" && (
              <MediaSection windowId={windowId} query={query} hooks={hooks} viewing={viewing} setViewing={setViewing} focusSearch={() => search.current?.focus()} />
            )}
          </Animated.View>
        </View>
      </View>
    </Animated.View>
    </View>
  );
}

function RailButton({ title, icon, selected, onPress }: { title: string; icon: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable {...hoverProps} onPress={onPress} style={{ width: RAIL - 18, paddingVertical: 10, borderRadius: 12, alignItems: "center", gap: 5, backgroundColor: selected ? (theme.dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)") : hovered ? theme.rowHover : "transparent" }}>
      <Symbol name={icon} size={20} weight="regular" color={selected ? theme.textPrimary : theme.textSecondary} style={{ width: 26, height: 24 }} />
      <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: selected ? "700" : "500", color: selected ? theme.textPrimary : theme.textSecondary }}>
        {title}
      </Text>
    </Pressable>
  );
}

function SpacesSection({ windowId, query, hooks }: { windowId: string; query: string; hooks: LibraryHooks }) {
  const theme = useTheme();
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const profileIds = useBrowser(useShallow((s) => s.profileOrder.filter((id) => s.profiles[id])));
  const scroller = useRef<ScrollView>(null);
  const [offset, setOffset] = useState(0);
  const [viewport, setViewport] = useState(0);
  const step = COLUMN + SPACE_GAP;
  const content = profileIds.length * step - SPACE_GAP + 24;
  const maxOffset = Math.max(0, content - viewport);
  const perPage = Math.max(1, Math.floor((viewport + SPACE_GAP) / step));
  const first = Math.min(profileIds.length - 1, Math.round(offset / step));
  const go = (x: number) => scroller.current?.scrollTo({ x: Math.max(0, Math.min(maxOffset, x)), animated: true });
  const page = (direction: 1 | -1) => go(Math.round(offset / step + direction * perPage) * step);
  hooks.spaces = page;
  useEffect(() => () => void (hooks.spaces = null), [hooks]);
  return (
    <View style={{ flex: 1 }} onLayout={(e) => setViewport(e.nativeEvent.layout.width)}>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator
        scrollEventThrottle={16}
        onScroll={(e) => setOffset(e.nativeEvent.contentOffset.x)}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingRight: 24, paddingBottom: 12, gap: SPACE_GAP }}
      >
        {profileIds.map((id, i) => (
          <PageProfileContext.Provider key={id} value={id}>
            <ThemeScope>
              <SpaceColumn windowId={windowId} profileId={id} query={query} index={i} filled={filled} />
            </ThemeScope>
          </PageProfileContext.Provider>
        ))}
      </ScrollView>
      {maxOffset > 0 ? (
        <View style={{ height: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14, paddingRight: 24 }}>
          <IconButton icon="chevron.left" size={13} box={30} radius={15} disabled={offset <= 1} onPress={() => page(-1)} tooltip="Previous Spaces (←)" />
          <View style={{ flexDirection: "row", gap: 6 }}>
            {profileIds.map((id, i) => {
              const visible = i >= first && i < first + perPage;
              return (
                <Pressable key={id} onPress={() => go(i * step)} tooltip={useBrowser.getState().profiles[id]?.name}>
                  <View style={{ width: visible ? 16 : 6, height: 6, borderRadius: 3, backgroundColor: theme.textPrimary, opacity: visible ? 0.85 : 0.25 }} />
                </Pressable>
              );
            })}
          </View>
          <IconButton icon="chevron.right" size={13} box={30} radius={15} disabled={offset >= maxOffset - 1} onPress={() => page(1)} tooltip="Next Spaces (→)" />
        </View>
      ) : null}
    </View>
  );
}

const SpaceColumn = memo(function SpaceColumn({ windowId, profileId, query, index, filled }: { windowId: string; profileId: string; query: string; index: number; filled: boolean }) {
  const theme = useTheme();
  const name = useBrowser((s) => s.profiles[profileId]?.name ?? "");
  const icon = useBrowser((s) => s.profiles[profileId]?.icon ?? null);
  const current = useBrowser((s) => s.windows[windowId]?.profileId === profileId);
  const ids = useBrowser(useShallow((s) => viewTabIds(s, windowId, profileId)));
  const tabs = useBrowser(useShallow((s) => ids.map((id) => s.tabs[id])));
  const shown = tabs.filter((t) => !!t && matchesQuery(query, t.customTitle ?? t.title, t.url || t.pinnedUrl || ""));
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(enter, { toValue: 1, delay: index * 40, speed: 16, bounciness: 4, useNativeDriver: true }).start();
  }, []);
  const go = (tabId: string) => {
    const s = useBrowser.getState();
    if (s.windows[windowId]?.profileId !== profileId) s.switchProfile(windowId, profileId);
    useBrowser.getState().activate(tabId);
    closeLibrary(windowId);
  };
  return (
    <Animated.View
      style={{
        width: COLUMN,
        borderRadius: 16,
        overflow: "hidden",
        borderWidth: current ? 2 : StyleSheet.hairlineWidth,
        borderColor: current ? theme.accent : theme.dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",
        opacity: enter,
        transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
      }}
    >
      <ThemeTint colors={theme.windowTint} accent={theme.profileColor === "incognito" ? null : theme.accent} />
      <View style={{ height: 44, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 8 }}>
        {icon ? <Text style={{ fontSize: 15 }}>{icon}</Text> : null}
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontWeight: "700", color: theme.textPrimary }}>
          {name}
        </Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 6, paddingBottom: 10 }}>
        {(filled ? shown : []).map((t) => (
          <TabLine key={t!.id} title={t!.customTitle ?? t!.title} url={t!.url || t!.pinnedUrl || ""} favicon={t!.favicon} profileId={profileId} pinned={!!t!.pinned} onPress={() => go(t!.id)} />
        ))}
        {filled && !shown.length && <Text style={{ padding: 12, fontSize: 12, color: theme.textSecondary }}>{query ? "No matches" : "No tabs"}</Text>}
      </ScrollView>
    </Animated.View>
  );
});

function TabLine({ title, url, favicon, profileId, pinned, onPress, detail }: { title: string; url: string; favicon: string | null; profileId: string; pinned?: boolean; onPress: () => void; detail?: string }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable {...hoverProps} onPress={onPress} tooltip={url} style={{ height: detail ? 44 : 34, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 8, borderRadius: 9, backgroundColor: hovered ? theme.rowHover : "transparent" }}>
      <Favicon url={url} favicon={favicon} profileId={profileId} size={16} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, color: theme.textPrimary, fontWeight: pinned ? "600" : "400" }}>
          {title || (url ? hostLabel(url) : "New Tab")}
        </Text>
        {detail ? (
          <Text numberOfLines={1} style={{ fontSize: 11.5, color: theme.textTertiary }}>
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function ArchiveSection({ windowId, query }: { windowId: string; query: string }) {
  const theme = useTheme();
  const profileId = useBrowser((s) => s.windows[windowId]?.profileId);
  const cleaned = useBrowser(useShallow((s) => cleanedIn(cleanedTabsFor(s, windowId), profileId)));
  const closedTabs = useBrowser((s) => s.closedTabs);
  const closed = useMemo(() => archivedFor(closedTabs, profileId), [closedTabs, profileId]);
  const groups = useMemo(() => {
    const entries: { entry: ClosedTab; from: "cleaned" | "closed" }[] = [
      ...cleaned.map((entry) => ({ entry, from: "cleaned" as const })),
      ...closed.map((entry) => ({ entry, from: "closed" as const })),
    ].filter(({ entry }) => matchesQuery(query, entry.tab.title, entry.tab.url));
    return byDay(entries, (e) => e.entry.closedAt);
  }, [cleaned, closed, query]);
  const restore = ({ entry, from }: { entry: ClosedTab; from: "cleaned" | "closed" }) => {
    const s = useBrowser.getState();
    if (from === "cleaned") s.restoreCleaned(entry.id, windowId);
    else s.restoreClosed(entry.id, windowId);
    closeLibrary(windowId);
  };
  if (!groups.length) return <Empty icon="archivebox" text={query ? "No archived tabs match" : "Tabs you close or clean up land here"} />;
  return (
    <ScrollView contentContainerStyle={{ paddingRight: 24, paddingBottom: 30, maxWidth: 760 }}>
      {groups.map((g) => (
        <View key={g.title} style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textSecondary, marginBottom: 4, marginLeft: 8 }}>{g.title}</Text>
          {g.items.map((item) => (
            <TabLine
              key={`${item.from}:${item.entry.id}`}
              title={item.entry.tab.title}
              url={item.entry.tab.url}
              favicon={item.entry.tab.favicon ?? null}
              profileId={item.entry.tab.profileId}
              detail={item.entry.tab.url.replace(/^https?:\/\/(www\.)?/, "")}
              onPress={() => restore(item)}
            />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

function DownloadsSection({ windowId, query }: { windowId: string; query: string }) {
  const downloads = useBrowser(useShallow((s) => downloadsIn(s, windowId)));
  const shown = downloads.filter((d) => matchesQuery(query, d.filename, d.url));
  if (!shown.length) return <Empty icon="arrow.down.circle" text={query ? "No downloads match" : "Files you download appear here"} />;
  return (
    <ScrollView contentContainerStyle={{ paddingRight: 24, paddingBottom: 30, gap: 8, maxWidth: 760 }}>
      {shown.map((d) => (
        <DownloadCard key={d.id} d={d} windowId={windowId} />
      ))}
    </ScrollView>
  );
}


async function mediaMenu(d: Download, windowId: string, view: () => void) {
  const choice = await showMenu([
    { id: "view", title: "Preview" },
    { id: "preview", title: "Open in Preview" },
    { id: "reveal", title: "Show in Finder" },
    { separator: true },
    { id: "copy", title: "Copy" },
    { id: "copyLink", title: "Copy Download Link" },
    { separator: true },
    { id: "trash", title: "Move to Trash" },
  ]);
  if (choice === "view") view();
  if (choice === "preview") void openInPreview(d.path);
  if (choice === "reveal") void revealFile(d.path);
  if (choice === "copy") void copyFile(d.path);
  if (choice === "copyLink") copyText(d.url);
  if (choice === "trash") void moveToTrash(d.path).then((ok) => ok && useBrowser.getState().removeDownload(d.id));
}

function MediaSection({
  windowId,
  query,
  hooks,
  viewing,
  setViewing,
  focusSearch,
}: {
  windowId: string;
  query: string;
  hooks: LibraryHooks;
  viewing: string | null;
  setViewing: (path: string | null) => void;
  focusSearch: () => void;
}) {
  const theme = useTheme();
  const downloads = useBrowser(useShallow((s) => downloadsIn(s, windowId)));
  const media = downloads.filter((d) => d.state === "finished" && (IMAGE.test(d.path) || VIDEO.test(d.path)) && fileExists(d.path) && matchesQuery(query, d.filename, d.url));
  const images = media.filter((d) => IMAGE.test(d.path));
  const open = (d: Download) => {
    if (IMAGE.test(d.path)) {
      setViewing(d.path);
      focusSearch();
      return;
    }
    closeLibrary(windowId);
    openUrl(fileUri(d.path), windowId, "foreground");
  };
  const step = (by: number) => {
    const at = images.findIndex((d) => d.path === viewing);
    if (at < 0 || !images.length) return;
    setViewing(images[(at + by + images.length) % images.length]!.path);
  };
  hooks.media = (key) => {
    if (!viewing) return false;
    if (key === "Escape") setViewing(null);
    else if (key === "ArrowLeft") step(-1);
    else if (key === "ArrowRight") step(1);
    else return false;
    return true;
  };
  useEffect(() => () => void (hooks.media = null), [hooks]);
  if (!media.length) return <Empty icon="photo.on.rectangle" text={query ? "No media matches" : "Images and videos you download appear here"} />;
  const shown = viewing ? media.find((d) => d.path === viewing) : undefined;
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingRight: 24, paddingBottom: 30, flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
        {media.map((d) => (
          <MediaTile key={d.id} d={d} onOpen={() => open(d)} onMenu={() => void mediaMenu(d, windowId, () => open(d))} />
        ))}
      </ScrollView>
      {shown ? <MediaViewer d={shown} count={images.length} onClose={() => setViewing(null)} onStep={step} windowId={windowId} /> : null}
    </View>
  );
}

function MediaTile({ d, onOpen, onMenu }: { d: Download; onOpen: () => void; onMenu: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <ContextMenuArea onContextMenu={onMenu}>
      <Pressable {...hoverProps} onPress={onOpen} tooltip={d.filename} style={{ width: 168, gap: 6 }}>
        <View
          style={{
            width: 168,
            height: 118,
            borderRadius: 12,
            overflow: "hidden",
            backgroundColor: theme.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 2,
            borderColor: hovered ? theme.accent : "transparent",
          }}
        >
          {IMAGE.test(d.path) ? (
            <Image source={{ uri: fileUri(d.path) }} resizeMode="cover" style={StyleSheet.absoluteFill} />
          ) : (
            <Symbol name="play.rectangle.fill" size={30} color={theme.textSecondary} style={{ width: 40, height: 34 }} />
          )}
        </View>
        <Text numberOfLines={1} style={{ fontSize: 12, color: theme.textPrimary }}>
          {d.filename}
        </Text>
      </Pressable>
    </ContextMenuArea>
  );
}

function MediaViewer({ d, count, onClose, onStep, windowId }: { d: Download; count: number; onClose: () => void; onStep: (by: number) => void; windowId: string }) {
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);
  const button = (icon: string, tip: string, onPress: () => void) => <IconButton icon={icon} size={14} box={32} radius={16} color="#FFFFFF" tooltip={tip} onPress={onPress} />;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: appear, marginRight: 24, marginBottom: 12, borderRadius: 14, overflow: "hidden" }]}>
      <Pressable onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.88)" }]} />
      <Animated.View pointerEvents="none" style={{ position: "absolute", left: 60, right: 60, top: 54, bottom: 30, transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }}>
        <Image source={{ uri: fileUri(d.path) }} resizeMode="contain" style={{ flex: 1 }} />
      </Animated.View>
      <View style={{ position: "absolute", left: 12, right: 12, top: 10, flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Text numberOfLines={1} style={{ flex: 1, marginLeft: 6, fontSize: 13, fontWeight: "600", color: "#FFFFFF" }}>
          {d.filename}
        </Text>
        {button("eye", "Open in Preview", () => void openInPreview(d.path))}
        {button("folder", "Show in Finder", () => void revealFile(d.path))}
        {button("doc.on.doc", "Copy", () => void copyFile(d.path))}
        {button("trash", "Move to Trash", () => void moveToTrash(d.path).then((ok) => ok && (onClose(), useBrowser.getState().removeDownload(d.id))))}
        {button("xmark", "Close (Esc)", onClose)}
      </View>
      {count > 1 ? (
        <>
          <View style={{ position: "absolute", left: 12, top: "50%", marginTop: -16 }}>{button("chevron.left", "Previous (←)", () => onStep(-1))}</View>
          <View style={{ position: "absolute", right: 12, top: "50%", marginTop: -16 }}>{button("chevron.right", "Next (→)", () => onStep(1))}</View>
        </>
      ) : null}
    </Animated.View>
  );
}

function Empty({ icon, text }: { icon: string; text: string }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingRight: 24 }}>
      <Symbol name={icon} size={30} color={theme.textTertiary} style={{ width: 40, height: 40 }} />
      <Text style={{ fontSize: 13, color: theme.textSecondary }}>{text}</Text>
    </View>
  );
}

