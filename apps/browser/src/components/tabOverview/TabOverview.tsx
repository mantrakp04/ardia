import { onWindowEvent, Symbol, VisualEffect, watchPinch } from "@ardia/shell";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, findNodeHandle, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { closeTab, switchToTab } from "../../lib/actions";
import { claimFocusTag } from "../../lib/focusClaims";
import { ThemeTint } from "../theme/ThemeTint";
import { lastPicture, rememberPicture, startTabPictures } from "../../lib/tabPictures";
import { matchesQuery, moveInGrid, overviewColumns, overviewGrid } from "../../lib/tabOverviewFilter";
import { useTheme } from "../../lib/theme";
import { webviews } from "../../lib/webviews";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import { activeTabId } from "../../store/model";
import { Favicon, useHover } from "../primitives";
import { filterSections, overviewSections, type OverviewItem } from "./model";
import { pageOwnsPinch } from "./pinchedPages";
import { cancelPinch, closeTabOverview, endPinch, followPinch, openedBeforePinch, revealOf, TAB_OVERVIEW_FOCUS, tabOverviewOpen, useTabOverview } from "./state";

const GAP = 22;
const MIN_CARD = 220;
const ASPECT = 1.5;
const SIDE = 40;
const TOP = 52;
const TRAY_PAD = 32;
const TRAY_MIN = 150;
const TRAY_GAP = 16;
const KEYS = ["Escape", "Enter", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].map((key) => ({ key }));

type Folder = Extract<OverviewItem, { kind: "folder" }>;

let pinchWatchers = 0;

export function TabOverviewHost() {
  const windowId = useWindowId();
  const open = useTabOverview((s) => !!s.open[windowId]);
  useEffect(startTabPictures, []);
  useEffect(() => {
    if (pinchWatchers++ === 0) watchPinch(true);
    const sub = onWindowEvent((e) => {
      if (e.type !== "pinch" || e.id !== windowId) return;
      if (e.phase !== "changed") return endPinch(windowId, e.phase === "cancelled");
      const s = useBrowser.getState();
      if (!s.settings.tabOverviewPinch && !openedBeforePinch(windowId)) return;
      if ((e.onPage === false || pageOwnsPinch(activeTabId(s, windowId))) && !openedBeforePinch(windowId)) return cancelPinch(windowId);
      if (!tabOverviewOpen(windowId) && (s.peeks[windowId] || s.windowUi[windowId]?.panel.open)) return;
      followPinch(windowId, e.total);
    });
    return () => {
      sub.remove();
      if (--pinchWatchers === 0) watchPinch(false);
    };
  }, [windowId]);
  return open ? <TabOverview windowId={windowId} /> : null;
}

type Flat = { item: OverviewItem; key: string };

const itemKey = (item: OverviewItem) => (item.kind === "tab" ? item.id : item.key);

function TabOverview({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const reveal = revealOf(windowId);
  const [tabs, windows, groups, splits] = useBrowser(useShallow((s) => [s.tabs, s.windows, s.groups, s.splits] as const));
  const all = useMemo(() => overviewSections(useBrowser.getState(), windowId), [tabs, windows, groups, splits, windowId]);
  const active = useBrowser((s) => activeTabId(s, windowId));
  const [query, setQuery] = useState("");
  const sections = useMemo(() => {
    const matches = (id: string) => {
      const t = tabs[id];
      return !!t && matchesQuery(`${t.customTitle ?? t.title} ${t.url || t.pinnedUrl || ""}`, query);
    };
    return filterSections(all, matches, query);
  }, [all, tabs, query]);
  const flat: Flat[] = useMemo(() => sections.flatMap((s) => s.items.map((item) => ({ item, key: itemKey(item) }))), [sections]);
  const [width, setWidth] = useState(0);
  const columns = overviewColumns(width - SIDE * 2, MIN_CARD, GAP);
  const card = width > 0 ? Math.floor((width - SIDE * 2 - GAP * (columns - 1)) / columns) : MIN_CARD;
  const scroller = useRef<ScrollView>(null);
  const placedCurrent = useRef(false);
  const showCurrent = (card: View) => {
    const list = scroller.current?.getNativeScrollRef?.() as View | null | undefined;
    if (placedCurrent.current || !list) return;
    placedCurrent.current = true;
    card.measureInWindow((_x, y, _w, h) =>
      list.measureInWindow((_lx, top, _lw, height) => {
        const offset = y - top - (height - h) / 2;
        if (offset > 0) scroller.current?.scrollTo({ y: offset, animated: false });
      }),
    );
  };
  const [expanded, setExpanded] = useState<string | null>(null);
  const openFolder = flat.find((f): f is { item: Folder; key: string } => f.item.kind === "folder" && f.key === expanded)?.item ?? null;
  const trayColumns = overviewColumns(width - SIDE * 2 - TRAY_PAD, TRAY_MIN, TRAY_GAP);
  const grid = useMemo(
    () => overviewGrid(sections.map((s) => s.items.map(itemKey)), columns, openFolder ? { after: openFolder.key, keys: openFolder.tabIds, columns: trayColumns } : null),
    [sections, columns, openFolder, trayColumns],
  );
  const [selected, setSelected] = useState<string | null>(() => (active && flat.some((f) => f.key === active) ? active : (flat[0]?.key ?? null)));
  const firstKey = grid[0]?.[0] ?? null;
  const searched = useRef(false);
  useEffect(() => {
    if (!searched.current) {
      searched.current = true;
      return;
    }
    setSelected(firstKey);
  }, [query]);
  useEffect(() => {
    if (selected !== null && !grid.some((row) => row.includes(selected))) setSelected(firstKey);
  }, [grid]);
  const [fresh, setFresh] = useState(0);
  const input = useRef<TextInput>(null);
  const total = flat.reduce((n, f) => n + (f.item.kind === "tab" ? 1 : f.item.tabIds.length), 0);

  useEffect(() => {
    input.current?.focus();
    claimFocusTag(windowId, TAB_OVERVIEW_FOCUS, () => findNodeHandle(input.current));
    if (active) void rememberPicture(active).then(() => setFresh((n) => n + 1));
    return () => {
      const now = activeTabId(useBrowser.getState(), windowId);
      if (now) void webviews.get(now)?.focus();
    };
  }, []);

  const choose = (tabId: string | undefined) => {
    if (tabId) switchToTab(tabId);
    closeTabOverview(windowId);
  };
  const toggleFolder = (key: string) => setExpanded((e) => (e === key ? null : key));
  const activate = (key: string | null) => {
    if (!key) return;
    const f = flat.find((x) => x.key === key);
    if (f?.item.kind === "folder") return toggleFolder(f.key);
    choose(key);
  };

  let index = 0;
  return (
    <Animated.View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={[StyleSheet.absoluteFill, { opacity: reveal }]}>
      <VisualEffect material="fullScreenUI" blendingMode="withinWindow" style={StyleSheet.absoluteFill} />
      <ThemeTint colors={theme.windowTint} accent={theme.profileColor === "incognito" ? null : theme.accent} />
      <Pressable onPress={() => closeTabOverview(windowId)} style={StyleSheet.absoluteFill} />
      <Animated.View
        style={{
          flex: 1,
          transform: [
            { scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [1.1, 1] }) },
            { translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
          ],
        }}
      >
        <View style={{ paddingTop: TOP, paddingHorizontal: SIDE, paddingBottom: 6, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Text style={{ fontSize: 20, fontWeight: "700", color: theme.textPrimary }}>All Tabs</Text>
          <Text style={{ fontSize: 13, color: theme.textSecondary, fontVariant: ["tabular-nums"] }}>{total}</Text>
          <View style={{ flex: 1 }} />
          <View style={{ width: 260, height: 30, borderRadius: 8, flexDirection: "row", alignItems: "center", paddingHorizontal: 9, gap: 6, backgroundColor: theme.dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" }}>
            <Symbol name="magnifyingglass" size={12} color={theme.textSecondary} style={{ width: 14, height: 14 }} />
            <TextInput
              ref={input}
              value={query}
              onChangeText={setQuery}
              placeholder="Search Tabs"
              placeholderTextColor={theme.placeholder}
              selectionColor={theme.selection}
              enableFocusRing={false}
              keyDownEvents={KEYS}
              onKeyDown={(e) => {
                const { key } = e.nativeEvent;
                if (key === "Escape") {
                  if (expanded) return setExpanded(null);
                  return query ? setQuery("") : closeTabOverview(windowId);
                }
                if (key === "Enter") return activate(selected);
                setSelected((current) => moveInGrid(grid, current, key));
              }}
              style={{ flex: 1, fontSize: 13, color: theme.textPrimary, paddingVertical: 0 }}
            />
          </View>
        </View>
        <ScrollView ref={scroller} contentContainerStyle={{ paddingHorizontal: SIDE, paddingBottom: SIDE }}>
          {sections.map((section) => {
            const rows: OverviewItem[][] = [];
            for (let i = 0; i < section.items.length; i += columns) rows.push(section.items.slice(i, i + columns));
            return (
              <View key={section.title} style={{ marginTop: 14 }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: theme.textSecondary, marginBottom: 10 }}>{section.title}</Text>
                {rows.map((row, r) => {
                  const open = row.find((item): item is Folder => item.kind === "folder" && item.key === expanded);
                  return (
                    <View key={r}>
                      <View style={{ flexDirection: "row", gap: GAP, marginBottom: GAP }}>
                        {row.map((item) => {
                          const i = index++;
                          return item.kind === "tab" ? (
                            <TabCard key={item.id} tabId={item.id} width={card} index={i} selected={item.id === selected} current={item.id === active} fresh={fresh} onOpen={() => choose(item.id)} onPlaced={item.id === active ? showCurrent : undefined} />
                          ) : (
                            <FolderCard key={item.key} item={item} width={card} index={i} selected={item.key === selected} open={expanded === item.key} onPress={() => toggleFolder(item.key)} />
                          );
                        })}
                      </View>
                      {open ? <FolderTray key={open.key} item={open} caretX={row.indexOf(open) * (card + GAP) + card / 2} active={active} selected={selected} fresh={fresh} onOpen={choose} /> : null}
                    </View>
                  );
                })}
              </View>
            );
          })}
          {!sections.length && <Text style={{ textAlign: "center", marginTop: 80, fontSize: 14, color: theme.textSecondary }}>{query ? "No tabs match" : "No tabs"}</Text>}
        </ScrollView>
      </Animated.View>
    </Animated.View>
  );
}

function useEnter(index: number) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(enter, { toValue: 1, delay: Math.min(index, 14) * 14, speed: 18, bounciness: 5, useNativeDriver: true }).start();
  }, []);
  return enter;
}

const TabCard = memo(function TabCard({
  tabId,
  width,
  index,
  selected,
  current,
  fresh,
  onOpen,
  onPlaced,
  small = false,
}: {
  tabId: string;
  width: number;
  index: number;
  selected: boolean;
  current: boolean;
  fresh: number;
  onOpen: () => void;
  onPlaced?: (view: View) => void;
  small?: boolean;
}) {
  const theme = useTheme();
  const tab = useBrowser((s) => s.tabs[tabId]);
  const { hovered, hoverProps } = useHover();
  const close = useHover();
  const picture = useMemo(() => lastPicture(tabId), [tabId, fresh]);
  const enter = useEnter(index);
  const place = useRef<View>(null);
  if (!tab) return null;
  const url = tab.url || tab.pinnedUrl || "";
  const name = tab.customTitle || tab.title || hostOf(url) || "New Tab";
  const ring = selected || current ? theme.accent : theme.dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)";
  return (
    <Animated.View
      ref={place}
      onLayout={onPlaced ? () => place.current && onPlaced(place.current) : undefined}
      style={{ width, opacity: enter, transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }}
    >
      <Pressable {...hoverProps} onPress={onOpen} tooltip={url || undefined}>
        <View style={{ height: small ? 22 : 26, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 2 }}>
          <Favicon url={url} favicon={tab.favicon} profileId={tab.profileId} size={small ? 12 : 14} />
          <Text numberOfLines={1} style={{ flex: 1, fontSize: small ? 11 : 12, fontWeight: current ? "600" : "500", color: theme.textPrimary }}>
            {name}
          </Text>
          {hovered && !small && !tab.pinned ? (
            <Pressable {...close.hoverProps} onPress={() => void closeTab(tabId)} tooltip="Close Tab">
              <View style={{ width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: close.hovered ? theme.rowHover : "transparent" }}>
                <Symbol name="xmark" size={9} weight="bold" color={theme.textSecondary} style={{ width: 10, height: 10 }} />
              </View>
            </Pressable>
          ) : null}
        </View>
        <View
          style={{
            width,
            height: Math.round(width / ASPECT),
            borderRadius: small ? 8 : 10,
            overflow: "hidden",
            borderWidth: selected || current ? 2.5 : 1,
            borderColor: ring,
            backgroundColor: theme.card,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {picture ? (
            <Image source={{ uri: `data:image/jpeg;base64,${picture.data}` }} resizeMode="cover" style={StyleSheet.absoluteFill} />
          ) : (
            <Favicon url={url} favicon={tab.favicon} profileId={tab.profileId} size={small ? 26 : 38} />
          )}
          {tab.pinned ? (
            <View style={{ position: "absolute", top: 6, right: 6, width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: theme.dark ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.85)" }}>
              <Symbol name="pin.fill" size={8} color={theme.textSecondary} style={{ width: 10, height: 10 }} />
            </View>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
});

const FolderCard = memo(function FolderCard({
  item,
  width,
  index,
  selected,
  open,
  onPress,
}: {
  item: Folder;
  width: number;
  index: number;
  selected: boolean;
  open: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const tabs = useBrowser((s) => s.tabs);
  const { hovered, hoverProps } = useHover();
  const enter = useEnter(index);
  const height = Math.round(width / ASPECT);
  const cellHeight = Math.floor((height - 18) / 2);
  const cellWidth = Math.floor((width - 18) / 2);
  return (
    <Animated.View style={{ width, opacity: enter, transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }}>
      <Pressable {...hoverProps} onPress={onPress}>
        <View style={{ height: 26, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 2 }}>
          {item.icon ? <Text style={{ fontSize: 12 }}>{item.icon}</Text> : <Symbol name="folder.fill" size={12} color={theme.textSecondary} style={{ width: 15, height: 13 }} />}
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, fontWeight: "600", color: theme.textPrimary }}>
            {item.name}
          </Text>
          <Text style={{ fontSize: 11, color: theme.textSecondary, fontVariant: ["tabular-nums"] }}>{item.tabIds.length}</Text>
          <Symbol name={open ? "chevron.up" : "chevron.down"} size={9} weight="semibold" color={theme.textSecondary} style={{ width: 12, height: 10 }} />
        </View>
        <View
          style={{
            width,
            height,
            borderRadius: 12,
            padding: 6,
            gap: 6,
            flexDirection: "row",
            flexWrap: "wrap",
            overflow: "hidden",
            backgroundColor: hovered ? theme.rowHover : theme.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
          }}
        >
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                borderRadius: 12,
                borderWidth: selected || open ? 2.5 : 1,
                borderColor: selected || open ? theme.accent : theme.dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)",
              },
            ]}
          />
          {item.tabIds.slice(0, 4).map((id) => {
            const t = tabs[id];
            const picture = lastPicture(id);
            const url = t?.url || t?.pinnedUrl || "";
            return (
              <View key={id} style={{ width: cellWidth, height: cellHeight, borderRadius: 7, overflow: "hidden", backgroundColor: theme.card, alignItems: "center", justifyContent: "center" }}>
                {picture ? (
                  <Image source={{ uri: `data:image/jpeg;base64,${picture.data}` }} resizeMode="cover" style={StyleSheet.absoluteFill} />
                ) : t ? (
                  <Favicon url={url} favicon={t.favicon} profileId={t.profileId} size={20} />
                ) : null}
              </View>
            );
          })}
        </View>
      </Pressable>
    </Animated.View>
  );
});

function FolderTray({
  item,
  caretX,
  active,
  selected,
  fresh,
  onOpen,
}: {
  item: Folder;
  caretX: number;
  active: string | undefined;
  selected: string | null;
  fresh: number;
  onOpen: (tabId: string) => void;
}) {
  const theme = useTheme();
  const drop = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);
  useEffect(() => {
    Animated.timing(drop, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);
  const columns = overviewColumns(width - TRAY_PAD, TRAY_MIN, TRAY_GAP);
  const card = width > 0 ? Math.floor((width - TRAY_PAD - TRAY_GAP * (columns - 1)) / columns) : TRAY_MIN;
  const fill = theme.dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)";
  return (
    <Animated.View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ marginTop: 8 - GAP, marginBottom: GAP, opacity: drop, transform: [{ translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) }] }}
    >
      <View style={{ position: "absolute", left: caretX - 9, top: -8, width: 18, height: 18, transform: [{ rotate: "45deg" }], backgroundColor: fill, borderRadius: 3 }} />
      <View style={{ borderRadius: 16, padding: 16, backgroundColor: fill, gap: 12 }}>
        <Text style={{ fontSize: 15, fontWeight: "700", color: theme.textPrimary }}>{item.name}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
          {item.tabIds.map((id, i) => (
            <TabCard key={id} tabId={id} width={card} index={i} selected={id === selected} current={id === active} fresh={fresh} onOpen={() => onOpen(id)} small />
          ))}
        </View>
      </View>
    </Animated.View>
  );
}

function hostOf(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:www\.)?([^/?#]+)/i.exec(url);
  return match?.[1] ?? "";
}
