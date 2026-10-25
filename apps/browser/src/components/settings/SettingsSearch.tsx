import { Symbol } from "@ardia/shell";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View, type TextInput } from "react-native";
import { useTheme } from "../../lib/theme";
import { liquidGlass } from "../glass";
import { SearchField, useFormColors } from "./controls";
import { groupByPane, search } from "./searchMatch";
import { revealSetting, setSettingsQuery, useSettingsSearch } from "./searchState";
import { PANES, SETTINGS_INDEX, type SettingEntry } from "./settingsIndex";

export function SettingsSearchField() {
  const query = useSettingsSearch((s) => s.query);
  const focusRequest = useSettingsSearch((s) => s.focusRequest);
  const input = useRef<TextInput>(null);
  useEffect(() => {
    if (!focusRequest) return;
    input.current?.focus();
    input.current?.setSelection(0, useSettingsSearch.getState().query.length);
  }, [focusRequest]);
  return (
    <SearchField
      inputRef={input}
      value={query}
      onChangeText={(text) => {
        setSettingsQuery(text);
        useSettingsSearch.setState({ selected: 0 });
      }}
      placeholder="Search"
      onSubmit={() => {
        const hit = settingsResults(useSettingsSearch.getState().query)[useSettingsSearch.getState().selected];
        if (hit) revealSetting(hit.id);
      }}
      onArrow={(step) => {
        const count = settingsResults(useSettingsSearch.getState().query).length;
        if (!count) return;
        useSettingsSearch.setState((s) => ({ selected: Math.max(0, Math.min(count - 1, s.selected + step)) }));
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
        <Text style={{ fontSize: 13, fontWeight: "600", color: theme.textSecondary }}>No Results</Text>
        <Text style={{ fontSize: 12, marginTop: 4, textAlign: "center", color: theme.textTertiary }}>{`Nothing matches “${query.trim()}”.`}</Text>
      </View>
    );
  }
  return (
    <ScrollView ref={scroller} contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 12 }}>
      {groups.map((group) => (
        <View key={group.pane.id} onLayout={(e) => group.rows.forEach((r, i) => rowTops.set(r.index, e.nativeEvent.layout.y + 26 + i * RESULT_HEIGHT))}>
          <View style={{ height: 26, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, marginTop: 4 }}>
            <Symbol name={group.pane.icon} size={11} color={theme.textTertiary} style={{ width: 16, height: 16 }} />
            <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "600", color: theme.textTertiary }}>
              {group.pane.title}
            </Text>
          </View>
          {group.rows.map(({ entry, index }) => (
            <ResultRow key={entry.id} entry={entry} selected={index === selected} onHover={() => useSettingsSearch.setState({ selected: index })} />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const RESULT_HEIGHT = 40;

function ResultRow({ entry, selected, onHover }: { entry: SettingEntry; selected: boolean; onHover: () => void }) {
  const theme = useTheme();
  const colors = useFormColors();
  const detail = entry.section !== entry.title ? entry.section : entry.paneTitle;
  return (
    <Pressable onPress={() => revealSetting(entry.id)}>
      <View
        onMouseEnter={onHover}
        style={{ height: RESULT_HEIGHT, borderRadius: 7, justifyContent: "center", paddingHorizontal: 8, backgroundColor: selected ? colors.accent : undefined }}
      >
        <Text numberOfLines={1} style={{ fontSize: 13, color: selected ? "#FFFFFF" : theme.textPrimary }}>
          {entry.title}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 11, marginTop: 1, color: selected ? "rgba(255,255,255,0.8)" : theme.textSecondary }}>
          {detail}
        </Text>
      </View>
    </Pressable>
  );
}
