import { displayUrl, fuzzyScore } from "@ardia/core";
import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { switchToTab } from "../../state/browser/actions";
import { FadeLabel, font, Panel, radius, Symbol, weight } from "../ui";
import { useTheme } from "../ui/theme";
import { hostOf } from "../../lib/url";
import { useTabs } from "../../state/tabs/hooks";
import { restoreClosed } from "../../state/windows/actions";
import { useClosedGroups, useClosedTabs } from "../../state/sidebar/hooks";
import { searchCandidates, type Row } from "../../state/sidebar/searchTabs";
import { setSidebarUi, useSidebarUi } from "../../state/sidebar/sidebarUi";
import { TabIcon } from "./TabIcon";
import { SIDEBAR_SHADOW, SIDEBAR_TYPE } from "./tokens";

const WIDTH = 560;
const ROW = 36;
const MAX_ROWS = 10;
const SEARCH_RADIUS = 16;

export function SearchTabs({ windowId, windowWidth }: { windowId: string; windowWidth: number }) {
  const open = useSidebarUi((u) => u.searchTabs === windowId);
  return open ? <SearchPanel windowId={windowId} windowWidth={windowWidth} /> : null;
}

function SearchPanel({ windowId, windowWidth }: { windowId: string; windowWidth: number }) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const field = useRef<TextInput>(null);
  const focused = useRef(false);
  const focusOnce = () => {
    if (focused.current) return;
    focused.current = true;
    field.current?.focus();
  };
  const tabs = useTabs((t) => t);
  const closedTabs = useClosedTabs();
  const closedGroups = useClosedGroups();
  const sections = useMemo(() => {
    const { open, closed } = searchCandidates(windowId);
    const q = query.trim();
    if (!q) return [{ title: "Open Tabs", rows: open }, { title: "Recently Closed", rows: closed.slice(0, 8) }];
    const rank = (rows: Row[]) =>
      rows
        .map((r) => ({ r, score: Math.max(fuzzyScore(q, r.title), fuzzyScore(q, hostOf(r.url)) * 0.9, fuzzyScore(q, r.url) * 0.6) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.r);
    return [{ title: "Open Tabs", rows: rank(open) }, { title: "Recently Closed", rows: rank(closed).slice(0, 8) }];
  }, [query, tabs, closedTabs, closedGroups, windowId]);
  const rows = sections.flatMap((s) => s.rows);
  const close = () => setSidebarUi({ searchTabs: null });
  const choose = (row: Row | undefined) => {
    if (!row) return;
    close();
    if (row.kind === "tab") switchToTab(row.id);
    else restoreClosed(row.id, windowId);
  };
  const move = (delta: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, selected + delta));
    setSelected(next);
    scroll.current?.scrollTo({ y: Math.max(0, (next - MAX_ROWS + 2) * ROW), animated: false });
  };
  let index = -1;

  return (
    <>
      <Pressable onPress={close} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
      <Panel
        fill={theme.panel}
        radius={SEARCH_RADIUS}
        border={theme.panelBorder}
        shadow={SIDEBAR_SHADOW.searchTabs}
        style={{ position: "absolute", top: 56, left: Math.max(12, (windowWidth - WIDTH) / 2), width: Math.min(WIDTH, windowWidth - 24), paddingBottom: 6 }}
      >
        <View style={{ height: 50, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 10 }}>
          <Symbol name="magnifyingglass" size={15} weight="medium" color={theme.textPrimary} style={{ width: 18, height: 18 }} />
          <TextInput
            ref={field}
            onLayout={focusOnce}
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              setSelected(0);
              scroll.current?.scrollTo({ y: 0, animated: false });
            }}
            placeholder="Search Tabs"
            placeholderTextColor={theme.placeholder}
            selectionColor={theme.selection}
            enableFocusRing={false}
            onSubmitEditing={() => choose(rows[selected])}
            onBlur={close}
            keyDownEvents={[{ key: "Escape" }, { key: "ArrowUp" }, { key: "ArrowDown" }]}
            onKeyDown={(e) => {
              const key = e.nativeEvent.key;
              if (key === "Escape") close();
              if (key === "ArrowDown") move(1);
              if (key === "ArrowUp") move(-1);
            }}
            style={{ flex: 1, fontSize: SIDEBAR_TYPE.searchField, color: theme.textPrimary, paddingVertical: 0 }}
          />
        </View>
        <View style={{ height: 0.5, backgroundColor: theme.divider }} />
        <ScrollView ref={scroll} style={{ maxHeight: ROW * MAX_ROWS + 60 }} showsVerticalScrollIndicator={false}>
          {rows.length === 0 ? (
            <Text style={{ paddingHorizontal: 16, paddingVertical: 14, ...font.body, color: theme.textTertiary }}>No tabs match “{query.trim()}”</Text>
          ) : null}
          {sections.map((section) =>
            section.rows.length ? (
              <View key={section.title} style={{ paddingHorizontal: 6, paddingTop: 6 }}>
                <Text style={{ ...font.caption, fontWeight: weight.semibold, color: theme.textTertiary, paddingHorizontal: 10, paddingVertical: 4 }}>{section.title}</Text>
                {section.rows.map((row) => {
                  index++;
                  const i = index;
                  return <ResultRow key={`${row.kind}:${row.id}`} row={row} selected={i === selected} onHover={() => setSelected(i)} onPress={() => choose(row)} />;
                })}
              </View>
            ) : null,
          )}
        </ScrollView>
      </Panel>
    </>
  );
}

function ResultRow({ row, selected, onHover, onPress }: { row: Row; selected: boolean; onHover(): void; onPress(): void }) {
  const theme = useTheme();
  const detail = row.kind === "tab" ? (row.current && !row.where ? "Current Tab" : row.where) : row.detail;
  return (
    <Pressable onPress={onPress}>
      <View
        onMouseEnter={onHover}
        style={{ height: ROW, borderRadius: radius.card, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, gap: 10, backgroundColor: selected ? theme.rowSelected : undefined }}
      >
        <TabIcon url={row.url} favicon={row.favicon} icon={row.icon} />
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", minWidth: 0 }}>
          <FadeLabel text={row.title} fontSize={font.title.fontSize} color={theme.textPrimary} style={{ flex: 3, height: 19 }} />
          {row.url ? <FadeLabel text={`— ${displayUrl(row.url)}`} fontSize={font.title.fontSize} color={theme.textSecondary} style={{ flex: 2, height: 19, marginLeft: 5 }} /> : null}
        </View>
        {detail ? <Text style={{ ...font.small, color: theme.textTertiary }}>{detail}</Text> : null}
        {row.kind === "closed" ? <Symbol name="clock.arrow.circlepath" size={12} color={theme.textTertiary} style={{ width: 16, height: 16 }} /> : null}
      </View>
    </Pressable>
  );
}
