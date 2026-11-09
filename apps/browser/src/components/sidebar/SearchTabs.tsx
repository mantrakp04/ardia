import { displayUrl, fuzzyScore, hostOf } from "@ardia/core";
import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, View, type TextInput } from "react-native";
import { switchToTab } from "../../state/browser/actions";
import { Divider, FadeLabel, font, ListRow, Panel, radius, SearchField, space, Symbol, Text } from "../ui";
import { useTheme } from "../ui/theme";
import { useTabs } from "../../state/tabs/hooks";
import { restoreClosed } from "../../state/windows/actions";
import { useClosedGroups, useClosedTabs } from "../../state/sidebar/hooks";
import { searchCandidates, type Row } from "../../state/sidebar/searchTabs";
import { setSidebarUi, useSidebarUi } from "../../state/sidebar/sidebarUi";
import { TabIcon } from "./TabIcon";
import { SIDEBAR_SHADOW } from "./tokens";
import { SectionLabel } from "./SectionLabel";

const WIDTH = 560;
const ROW = 36;
const MAX_ROWS = 10;
const SEARCH_RADIUS = radius.sheet;
const FIELD_ROW = { height: 50, justifyContent: "center", paddingHorizontal: space.xl } as const;
const NO_MATCH = { paddingHorizontal: space.xl, paddingVertical: space.xl } as const;
const SECTION = { paddingHorizontal: space.s, paddingTop: space.s } as const;
const URL_LABEL_GAP = space.xs;

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
        style={{ position: "absolute", top: 56, left: Math.max(12, (windowWidth - WIDTH) / 2), width: Math.min(WIDTH, windowWidth - 24), paddingBottom: space.s }}
      >
        <View style={FIELD_ROW} onLayout={focusOnce}>
          <SearchField
            look="bare"
            inputRef={field}
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              setSelected(0);
              scroll.current?.scrollTo({ y: 0, animated: false });
            }}
            placeholder="Search Tabs"
            onSubmit={() => choose(rows[selected])}
            onEscape={close}
            onArrow={move}
            onBlur={close}
          />
        </View>
        <Divider />
        <ScrollView ref={scroll} style={{ maxHeight: ROW * MAX_ROWS + 60 }} showsVerticalScrollIndicator={false}>
          {rows.length === 0 ? (
            <Text tone="textTertiary" style={NO_MATCH}>
              No tabs match “{query.trim()}”
            </Text>
          ) : null}
          {sections.map((section) =>
            section.rows.length ? (
              <View key={section.title} style={SECTION}>
                <SectionLabel title={section.title} inset={space.ml} top={space.xs} bottom={space.xs} />
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
    <ListRow height={ROW} selected={selected} onPress={onPress} onHover={(hovered) => hovered && onHover()}>
        <TabIcon url={row.url} favicon={row.favicon} icon={row.icon} />
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", minWidth: 0 }}>
          <FadeLabel text={row.title} fontSize={font.title.fontSize} color={theme.textPrimary} style={{ flex: 3, height: 19 }} />
          {row.url ? <FadeLabel text={`— ${displayUrl(row.url)}`} fontSize={font.title.fontSize} color={theme.textSecondary} style={{ flex: 2, height: 19, marginLeft: URL_LABEL_GAP }} /> : null}
        </View>
        {detail ? (
          <Text size="small" tone="textTertiary">
            {detail}
          </Text>
        ) : null}
        {row.kind === "closed" ? <Symbol name="clock.arrow.circlepath" size={12} color={theme.textTertiary} style={{ width: 16, height: 16 }} /> : null}
    </ListRow>
  );
}
