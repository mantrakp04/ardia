import { tabTitle } from "../../state/browser/model";
import { discardKeyResponder, restoreKeyResponder, saveKeyResponder } from "../../state/windows/nativeWindow";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useTheme } from "../ui/theme";
import { ago } from "../../lib/time";
import { useGroup } from "../../state/browser/hooks";
import { sharedTabsForPanel } from "../../state/sidebar/current";
import { useGroupPanelTabIds, useTabsById } from "../../state/sidebar/hooks";
import type { Tab } from "../../state/browser/types";
import { FadeLabel, menuRowFill, MenuSeparator, PANEL, PopoverSurface, Symbol } from "../ui";
import { clickTab, returnFocusToPage } from "../../state/sidebar/actions";
import { byRecentUse, matchingRows, type GroupPanelTab } from "../../state/sidebar/groupPanelRows";
import { dismissHover, holdHover } from "../../state/sidebar/hover";
import { cardHoverProps } from "./hoverController";
import { hoverCardOrigin } from "./hoverMotion";
import { useSidebarUi, type Anchor } from "../../state/sidebar/sidebarUi";
import { TabIcon } from "./TabIcon";

const WIDTH = 264;
const SEARCH_ROW = 44;
const SEPARATOR = StyleSheet.hairlineWidth + PANEL.separatorGap * 2;
const ROW = 44;
const LIST_PAD = PANEL.inset - (ROW - PANEL.iconSlot) / 2;
const MAX_ROWS = 7;
const EDGE = 8;
const NOW_TICK_MS = 30_000;

type Row = GroupPanelTab & { favicon: string | null; icon: string | null; profileId: string };

function useGroupRows(groupId: string, windowId: string): Row[] {
  const ids = useGroupPanelTabIds(groupId);
  const tabs = useTabsById(ids);
  return useMemo(() => {
    const shared = sharedTabsForPanel(windowId);
    const rows = tabs
      .filter((t): t is Tab => !!t)
      .map((t) => ({ id: t.id, title: tabTitle(t), url: t.url, usedAt: shared?.lastUsed(t) ?? t.lastActiveAt, favicon: t.favicon, icon: t.customIcon, profileId: t.profileId }));
    return byRecentUse(rows);
  }, [tabs, windowId]);
}

export function GroupPanel({ groupId, windowId, anchor, windowHeight }: { groupId: string; windowId: string; anchor: Anchor; windowHeight: number }) {
  const theme = useTheme();
  const exists = useGroup(groupId, (g) => !!g);
  const all = useGroupRows(groupId, windowId);
  const live = useSidebarUi((u) => u.hover?.kind === "group" && u.hover.id === groupId && u.hover.windowId === windowId);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [now, setNow] = useState(Date.now);
  const field = useRef<TextInput>(null);
  const scroll = useRef<ScrollView>(null);
  const offset = useRef(0);
  const focused = useRef(false);
  const origin = useRef<Promise<number> | null>(null);
  const q = query.trim();
  const rows = useMemo(() => matchingRows(q, all), [q, all]);
  const current = Math.max(0, Math.min(selected, rows.length - 1));
  const listHeight = LIST_PAD * 2 + Math.max(1, Math.min(MAX_ROWS, all.length)) * ROW;
  const panelHeight = SEARCH_ROW + SEPARATOR + listHeight;
  const at = hoverCardOrigin(anchor);
  const top = Math.max(EDGE, Math.min(at.top, windowHeight - panelHeight - EDGE));

  const takeFocus = () => {
    if (focused.current) return;
    focused.current = true;
    const from = saveKeyResponder(windowId);
    origin.current = from;
    void from.then(() => {
      if (focused.current && origin.current === from) field.current?.focus();
    });
  };
  const handBack = (to: "origin" | "page") => {
    if (!focused.current) return;
    focused.current = false;
    holdHover(false);
    const from = origin.current;
    origin.current = null;
    if (to === "page" || !from) {
      if (from) void from.then(discardKeyResponder);
      return returnFocusToPage(windowId);
    }
    void from.then(restoreKeyResponder).then((restored) => {
      if (!restored) returnFocusToPage(windowId);
    });
  };
  const latestHandBack = useRef(handBack);
  latestHandBack.current = handBack;

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => {
    if (!live) latestHandBack.current("origin");
  }, [live]);
  useEffect(() => () => latestHandBack.current("origin"), []);

  const reveal = (index: number) => {
    const rowTop = LIST_PAD + index * ROW;
    if (rowTop - LIST_PAD < offset.current) scroll.current?.scrollTo({ y: rowTop - LIST_PAD, animated: false });
    else if (rowTop + ROW + LIST_PAD > offset.current + listHeight) scroll.current?.scrollTo({ y: rowTop + ROW + LIST_PAD - listHeight, animated: false });
  };
  const move = (delta: number) => {
    if (!rows.length) return;
    const next = Math.max(0, Math.min(rows.length - 1, current + delta));
    setSelected(next);
    reveal(next);
  };
  const close = () => {
    dismissHover();
    handBack("origin");
  };
  const choose = (row: Row | undefined) => {
    if (!row) return;
    dismissHover();
    clickTab(windowId, row.id);
    handBack("page");
  };

  if (!exists) return null;
  return (
    <PopoverSurface
      {...cardHoverProps}
      onMouseEnter={() => {
        cardHoverProps.onMouseEnter();
        if (live) takeFocus();
      }}
      style={{ position: "absolute", left: at.left, top, width: WIDTH, height: panelHeight }}
    >
      <View style={{ height: SEARCH_ROW, flexDirection: "row", alignItems: "center", gap: PANEL.iconGap, paddingHorizontal: PANEL.inset }}>
        <Symbol name="magnifyingglass" size={PANEL.iconSize} weight="medium" color={theme.textSecondary} style={{ width: PANEL.iconSlot, height: PANEL.iconSlot }} />
        <TextInput
          ref={field}
          value={query}
          onChangeText={(text) => {
            setQuery(text);
            holdHover(focused.current && text.trim().length > 0);
            setSelected(0);
            offset.current = 0;
            scroll.current?.scrollTo({ y: 0, animated: false });
          }}
          placeholder="Search Tabs"
          placeholderTextColor={theme.placeholder}
          selectionColor={theme.selection}
          enableFocusRing={false}
          onBlur={() => {
            if (!focused.current) return;
            focused.current = false;
            const from = origin.current;
            origin.current = null;
            if (from) void from.then(discardKeyResponder);
            holdHover(false);
          }}
          keyDownEvents={[{ key: "Enter" }, { key: "Escape" }, { key: "ArrowUp" }, { key: "ArrowDown" }]}
          onKeyDown={(e) => {
            const key = e.nativeEvent.key;
            if (key === "Enter") choose(rows[current]);
            if (key === "Escape") close();
            if (key === "ArrowDown") move(1);
            if (key === "ArrowUp") move(-1);
          }}
          style={{ flex: 1, fontSize: PANEL.titleSize, color: theme.textPrimary, paddingVertical: 0 }}
        />
      </View>
      <MenuSeparator />
      <ScrollView
        ref={scroll}
        style={{ height: listHeight }}
        contentContainerStyle={{ paddingVertical: LIST_PAD }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
          offset.current = e.nativeEvent.contentOffset.y;
        }}
      >
        {rows.length === 0 ? (
          <Text numberOfLines={1} style={{ paddingHorizontal: PANEL.inset, lineHeight: ROW, fontSize: PANEL.titleSize, color: theme.textTertiary }}>
            {q ? `No tabs match “${q}”` : "No tabs"}
          </Text>
        ) : null}
        {rows.map((row, i) => (
          <PanelRow key={row.id} row={row} now={now} selected={i === current} onHover={() => setSelected(i)} onPress={() => choose(row)} />
        ))}
      </ScrollView>
    </PopoverSurface>
  );
}

function PanelRow({ row, now, selected, onHover, onPress }: { row: Row; now: number; selected: boolean; onHover(): void; onPress(): void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={row.title}>
      {({ pressed }) => (
        <View
          onMouseEnter={onHover}
          style={{
            height: ROW,
            marginHorizontal: PANEL.rowInset,
            paddingHorizontal: PANEL.rowPadding,
            borderRadius: PANEL.rowRadius,
            flexDirection: "row",
            alignItems: "center",
            gap: PANEL.iconGap,
            backgroundColor: pressed || selected ? menuRowFill(theme, pressed) : undefined,
          }}
        >
          <View style={{ width: PANEL.iconSlot, height: PANEL.iconSlot, alignItems: "center", justifyContent: "center" }}>
            <TabIcon tabId={row.id} url={row.url} favicon={row.favicon} icon={row.icon} profileId={row.profileId} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <FadeLabel text={row.title} fontSize={PANEL.titleSize} color={theme.textPrimary} style={{ height: PANEL.titleLine }} />
            <Text numberOfLines={1} style={{ fontSize: PANEL.subtitleSize, lineHeight: PANEL.subtitleLine, color: theme.textSecondary }}>
              {ago(row.usedAt, now)}
            </Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}
