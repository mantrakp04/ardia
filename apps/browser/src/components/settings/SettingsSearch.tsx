import { Box, EmptyState, ListRow, SearchField, space, Symbol, Text } from "../ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type TextInput } from "react-native";
import { useTheme } from "../ui/theme";
import { groupByPane, search } from "./searchMatch";
import { currentSettingsSearch, moveSettingsSelection, revealSetting, setSettingsQuery, useSettingsSearch } from "../../state/settings/searchState";
import { PANES, SETTINGS_INDEX, type SettingEntry } from "./settingsIndex";
import { useUnshownSettings } from "./Form";
import { settingsInk } from "./tokens";
import { GROUP_GAP, GROUP_HEADER, RESULT_HEIGHT, RESULTS_BOTTOM, scrollToShow } from "./searchResultLayout";

export function SettingsSearchField() {
  const query = useSettingsSearch((s) => s.query);
  const focusRequest = useSettingsSearch((s) => s.focusRequest);
  const input = useRef<TextInput>(null);
  const unshown = useUnshownSettings();
  useEffect(() => {
    if (!focusRequest) return;
    input.current?.focus();
    input.current?.setSelection(0, currentSettingsSearch().query.length);
  }, [focusRequest]);
  return (
    <View style={FIELD}>
      <SearchField
      inputRef={input}
      value={query}
      onChangeText={(text) => {
        setSettingsQuery(text);
      }}
      placeholder="Search"
      onSubmit={() => {
        const { query, selected } = currentSettingsSearch();
        const hit = settingsResults(query, unshown)[selected];
        if (hit) revealSetting(hit, "keyboard");
      }}
      onArrow={(step) => {
        const count = settingsResults(currentSettingsSearch().query, unshown).length;
        if (!count) return;
        moveSettingsSelection(step, count);
      }}
      />
    </View>
  );
}

const FIELD = { marginHorizontal: space.ml, marginBottom: space.ml } as const;

let cached: { query: string; unshown: ReadonlySet<string>; results: SettingEntry[] } = { query: "", unshown: new Set(), results: [] };

export function settingsResults(query: string, unshown: ReadonlySet<string>): SettingEntry[] {
  if (cached.query !== query || cached.unshown !== unshown) {
    const hits = search(SETTINGS_INDEX.filter((p) => !unshown.has(p.entry.id)), query);
    cached = { query, unshown, results: groupByPane(hits).flatMap((g) => g.hits.map((h) => h.entry)) };
  }
  return cached.results;
}

export function SettingsSearchResults({ query }: { query: string }) {
  const theme = useTheme();
  const selected = useSettingsSearch((s) => s.selected);
  const keyboardMove = useSettingsSearch((s) => s.keyboardMove);
  const results = settingsResults(query, useUnshownSettings());
  const { groups, rowTops } = useMemo(() => resultLayout(results), [results]);
  const scroller = useRef<ScrollView>(null);
  const viewport = useRef({ offset: 0, height: 0 });
  useEffect(() => {
    viewport.current.offset = 0;
    scroller.current?.scrollTo({ y: 0, animated: false });
  }, [results]);
  useEffect(() => {
    if (!keyboardMove) return;
    const top = rowTops[selected];
    if (top === undefined) return;
    const { offset, height } = viewport.current;
    const target = scrollToShow(top, offset, height, selected === 0);
    if (target === offset) return;
    viewport.current.offset = target;
    scroller.current?.scrollTo({ y: target, animated: false });
  }, [keyboardMove]);

  if (!results.length) {
    return <EmptyState symbol="magnifyingglass" title="No Results" subtitle={`Nothing matches “${query.trim()}”.`} />;
  }
  return (
    <ScrollView
      ref={scroller}
      contentContainerStyle={RESULTS}
      scrollEventThrottle={16}
      onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => (viewport.current.offset = e.nativeEvent.contentOffset.y)}
      onLayout={(e: LayoutChangeEvent) => (viewport.current.height = e.nativeEvent.layout.height)}
    >
      {groups.map((group) => (
        <View key={group.pane.id}>
          <Box row gap="s" padX="m" style={GROUP_TITLE}>
            <Symbol name={group.pane.icon} size={11} color={theme.textTertiary} style={GROUP_ICON} />
            <Text size="caption" weight="semibold" tone="textTertiary" lines={1}>
              {group.pane.title}
            </Text>
          </Box>
          {group.rows.map(({ entry, index }) => (
            <ResultRow key={entry.id} entry={entry} selected={index === selected} />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

function resultLayout(results: SettingEntry[]) {
  const groups: { pane: (typeof PANES)[number]; rows: { entry: SettingEntry; index: number }[] }[] = [];
  const rowTops: number[] = [];
  let y = 0;
  results.forEach((entry, index) => {
    const last = groups.at(-1);
    if (last?.pane.id === entry.pane) last.rows.push({ entry, index });
    else {
      groups.push({ pane: PANES.find((p) => p.id === entry.pane)!, rows: [{ entry, index }] });
      y += GROUP_GAP + GROUP_HEADER;
    }
    rowTops.push(y);
    y += RESULT_HEIGHT;
  });
  return { groups, rowTops };
}

const RESULTS = { paddingHorizontal: space.ml, paddingBottom: RESULTS_BOTTOM } as const;
const GROUP_TITLE = { height: GROUP_HEADER, alignItems: "center", marginTop: GROUP_GAP } as const;
const GROUP_ICON = { width: 16, height: 16 } as const;

function ResultRow({ entry, selected }: { entry: SettingEntry; selected: boolean }) {
  const theme = useTheme();
  const detail = entry.section !== entry.title ? entry.section : entry.paneTitle;
  return (
    <ListRow height={RESULT_HEIGHT} selected={selected} selectedTone="accent" onPress={() => revealSetting(entry, "click")}>
      <View style={RESULT_TEXT}>
        <Text lines={1} tone={selected ? "onAccent" : "textPrimary"}>
          {entry.title}
        </Text>
        <Text size="caption" lines={1} color={selected ? settingsInk.onAccentSecondary : theme.textSecondary}>
          {detail}
        </Text>
      </View>
    </ListRow>
  );
}

const RESULT_TEXT = { flex: 1 } as const;
