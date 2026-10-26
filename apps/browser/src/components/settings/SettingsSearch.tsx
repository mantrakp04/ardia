import { Symbol, font, SearchField, weight } from "../ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View, type TextInput } from "react-native";
import { useTheme } from "../ui/theme";
import { liquidGlass } from "../ui/Glass";
import { groupByPane, search } from "./searchMatch";
import { currentSettingsSearch, moveSettingsSelection, revealSetting, selectSettingsResult, setSettingsQuery, useSettingsSearch } from "../../state/settings/searchState";
import { PANES, SETTINGS_INDEX, type SettingEntry } from "./settingsIndex";
import { settingsInk } from "./tokens";

export function SettingsSearchField() {
  const query = useSettingsSearch((s) => s.query);
  const focusRequest = useSettingsSearch((s) => s.focusRequest);
  const input = useRef<TextInput>(null);
  useEffect(() => {
    if (!focusRequest) return;
    input.current?.focus();
    input.current?.setSelection(0, currentSettingsSearch().query.length);
  }, [focusRequest]);
  return (
    <SearchField
      inputRef={input}
      value={query}
      onChangeText={(text) => {
        setSettingsQuery(text);
        selectSettingsResult(0);
      }}
      placeholder="Search"
      onSubmit={() => {
        const { query, selected } = currentSettingsSearch();
        const hit = settingsResults(query)[selected];
        if (hit) revealSetting(hit);
      }}
      onArrow={(step) => {
        const count = settingsResults(currentSettingsSearch().query).length;
        if (!count) return;
        moveSettingsSelection(step, count);
      }}
      style={{ marginHorizontal: 10, marginBottom: 10 }}
    />
  );
}

const SHOWN_INDEX = liquidGlass ? SETTINGS_INDEX : SETTINGS_INDEX.filter((p) => !p.entry.liquidGlassOnly);

let cached: { query: string; results: SettingEntry[] } = { query: "", results: [] };

export function settingsResults(query: string): SettingEntry[] {
  if (cached.query !== query) cached = { query, results: groupByPane(search(SHOWN_INDEX, query)).flatMap((g) => g.hits.map((h) => h.entry)) };
  return cached.results;
}

export function SettingsSearchResults({ query }: { query: string }) {
  const theme = useTheme();
  const selected = useSettingsSearch((s) => s.selected);
  const results = settingsResults(query);
  const groups = useMemo(() => {
    const out: { pane: (typeof PANES)[number]; rows: { entry: SettingEntry; index: number }[] }[] = [];
    results.forEach((entry, index) => {
      const last = out.at(-1);
      if (last?.pane.id === entry.pane) last.rows.push({ entry, index });
      else out.push({ pane: PANES.find((p) => p.id === entry.pane)!, rows: [{ entry, index }] });
    });
    return out;
  }, [results]);
  const scroller = useRef<ScrollView>(null);
  const [rowTops] = useState(() => new Map<number, number>());
  useEffect(() => {
    const top = rowTops.get(selected);
    if (top !== undefined) scroller.current?.scrollTo({ y: Math.max(0, top - 60), animated: false });
  }, [selected]);

  if (!results.length) {
    return (
      <View style={{ flex: 1, alignItems: "center", paddingTop: 40, paddingHorizontal: 16 }}>
        <Text style={{ ...font.body, fontWeight: weight.semibold, color: theme.textSecondary }}>No Results</Text>
        <Text style={{ ...font.small, marginTop: 4, textAlign: "center", color: theme.textTertiary }}>{`Nothing matches “${query.trim()}”.`}</Text>
      </View>
    );
  }
  return (
    <ScrollView ref={scroller} contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 12 }}>
      {groups.map((group) => (
        <View key={group.pane.id} onLayout={(e) => group.rows.forEach((r, i) => rowTops.set(r.index, e.nativeEvent.layout.y + 26 + i * RESULT_HEIGHT))}>
          <View style={{ height: 26, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, marginTop: 4 }}>
            <Symbol name={group.pane.icon} size={11} color={theme.textTertiary} style={{ width: 16, height: 16 }} />
            <Text numberOfLines={1} style={{ ...font.caption, fontWeight: weight.semibold, color: theme.textTertiary }}>
              {group.pane.title}
            </Text>
          </View>
          {group.rows.map(({ entry, index }) => (
            <ResultRow key={entry.id} entry={entry} selected={index === selected} onHover={() => selectSettingsResult(index)} />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const RESULT_HEIGHT = 40;

function ResultRow({ entry, selected, onHover }: { entry: SettingEntry; selected: boolean; onHover: () => void }) {
  const theme = useTheme();
  const detail = entry.section !== entry.title ? entry.section : entry.paneTitle;
  return (
    <Pressable onPress={() => revealSetting(entry)}>
      <View
        onMouseEnter={onHover}
        style={{ height: RESULT_HEIGHT, borderRadius: 7, justifyContent: "center", paddingHorizontal: 8, backgroundColor: selected ? theme.formAccent : undefined }}
      >
        <Text numberOfLines={1} style={{ ...font.body, color: selected ? theme.onAccent : theme.textPrimary }}>
          {entry.title}
        </Text>
        <Text numberOfLines={1} style={{ ...font.caption, marginTop: 1, color: selected ? settingsInk.onAccentSecondary : theme.textSecondary }}>
          {detail}
        </Text>
      </View>
    </Pressable>
  );
}
