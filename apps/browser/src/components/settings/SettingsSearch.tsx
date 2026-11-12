import { EmptyState, ListRow, SearchField, space, Text } from "../ui";
import { useEffect, useRef } from "react";
import { ScrollView, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type TextInput } from "react-native";
import { useTheme } from "../ui/theme";
import { search, snippetAround, splitByRanges, type SearchHit, type SearchRange } from "./searchMatch";
import {
  currentSettingsSearch,
  moveSettingsSelection,
  noteSettingsSearchEmpty,
  previewSetting,
  revealSetting,
  selectSettingsResult,
  setSettingsQuery,
  useSettingsSearch,
} from "../../state/settings/searchState";
import { SETTINGS_INDEX, type SettingEntry } from "./settingsIndex";
import { useUnshownSettings } from "./Form";
import { settingsInk } from "./tokens";
import { PREVIEW_DELAY_MS, RESULT_GAP, RESULT_MIN_HEIGHT, RESULTS_BOTTOM, RESULTS_TOP, scrollToShow } from "./searchResultLayout";

export type SettingsHit = SearchHit<SettingEntry>;

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
        onChangeText={setSettingsQuery}
        placeholder="Search"
        onSubmit={() => {
          const { query, selected } = currentSettingsSearch();
          const hit = settingsResults(query, unshown)[selected];
          if (hit) revealSetting(hit.entry, "keyboard", selected);
        }}
        onArrow={(step) => {
          const count = settingsResults(currentSettingsSearch().query, unshown).length;
          if (count) moveSettingsSelection(step, count);
        }}
        onEscape={() => {
          if (currentSettingsSearch().query) setSettingsQuery("");
        }}
      />
    </View>
  );
}

const FIELD = { marginHorizontal: space.ml, marginBottom: space.ml } as const;

let cached: { query: string; unshown: ReadonlySet<string>; results: SettingsHit[] } = { query: "", unshown: new Set(), results: [] };

export function settingsResults(query: string, unshown: ReadonlySet<string>): SettingsHit[] {
  if (cached.query !== query || cached.unshown !== unshown) {
    cached = { query, unshown, results: search(SETTINGS_INDEX.filter((p) => !unshown.has(p.entry.id)), query) };
  }
  return cached.results;
}

export function SettingsSearchResults({ query }: { query: string }) {
  const selected = useSettingsSearch((s) => s.selected);
  const keyboardMove = useSettingsSearch((s) => s.keyboardMove);
  const results = settingsResults(query, useUnshownSettings());
  const scroller = useRef<ScrollView>(null);
  const viewport = useRef({ offset: 0, height: 0 });
  const rows = useRef<{ top: number; height: number }[]>([]);
  const target = results[selected]?.entry;

  useEffect(() => {
    viewport.current.offset = 0;
    scroller.current?.scrollTo({ y: 0, animated: false });
    if (!results.length && query.trim().length >= 2) noteSettingsSearchEmpty();
  }, [results]);

  useEffect(() => {
    if (!target) return;
    const timer = setTimeout(() => previewSetting(target), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [target]);

  useEffect(() => {
    if (!keyboardMove) return;
    const row = rows.current[selected];
    if (!row) return;
    const { offset, height } = viewport.current;
    const next = scrollToShow(row.top, row.height, offset, height, selected === 0);
    if (next === offset) return;
    viewport.current.offset = next;
    scroller.current?.scrollTo({ y: next, animated: false });
  }, [keyboardMove]);

  if (!results.length) {
    return <EmptyState symbol="magnifyingglass" title="No Results" subtitle={`Nothing matches “${query.trim()}”. Try a setting's name or a shorter word, like “dark” or “downloads”.`} />;
  }
  return (
    <ScrollView
      ref={scroller}
      contentContainerStyle={RESULTS}
      scrollEventThrottle={16}
      onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => (viewport.current.offset = e.nativeEvent.contentOffset.y)}
      onLayout={(e: LayoutChangeEvent) => (viewport.current.height = e.nativeEvent.layout.height)}
    >
      {results.map((hit, index) => (
        <View key={hit.entry.id} style={ROW_GAP} onLayout={(e) => void (rows.current[index] = { top: e.nativeEvent.layout.y, height: e.nativeEvent.layout.height })}>
          <ResultRow hit={hit} selected={index === selected} rank={index} />
        </View>
      ))}
    </ScrollView>
  );
}

const RESULTS = { paddingHorizontal: space.ml, paddingTop: RESULTS_TOP, paddingBottom: RESULTS_BOTTOM } as const;
const ROW_GAP = { marginBottom: RESULT_GAP } as const;

function ResultRow({ hit, selected, rank }: { hit: SettingsHit; selected: boolean; rank: number }) {
  const theme = useTheme();
  const { entry } = hit;
  const primary = selected ? theme.onAccent : theme.textPrimary;
  const secondary = selected ? settingsInk.onAccentSecondary : theme.textSecondary;
  const showSection = entry.section !== entry.title && entry.section !== entry.paneTitle;
  const keyword = hit.note && entry.keywords?.includes(hit.note.text);
  const note = hit.note ? snippetAround(hit.note.text, hit.note.ranges) : null;
  return (
    <ListRow
      selected={selected}
      selectedTone="accent"
      onPress={() => {
        selectSettingsResult(rank);
        revealSetting(entry, "click", rank);
      }}
    >
      <View style={RESULT_TEXT}>
        <Text lines={3} color={primary}>
          <Marked text={entry.title} ranges={hit.title} color={primary} />
        </Text>
        <Text size="caption" lines={2} color={secondary}>
          {entry.paneTitle}
          {showSection ? " › " : ""}
          {showSection ? <Marked text={entry.section} ranges={hit.section} color={secondary} /> : null}
        </Text>
        {note ? (
          <Text size="caption" lines={2} color={secondary}>
            {keyword ? "Also called “" : ""}
            <Marked text={note.text} ranges={note.ranges} color={secondary} />
            {keyword ? "”" : ""}
          </Text>
        ) : null}
      </View>
    </ListRow>
  );
}

function Marked({ text, ranges, color }: { text: string; ranges: SearchRange[]; color: string }) {
  return (
    <>
      {splitByRanges(text, ranges).map((part, i) =>
        part.highlighted ? (
          <Text key={i} weight="bold" color={color}>
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

const RESULT_TEXT = { flex: 1, minHeight: RESULT_MIN_HEIGHT, justifyContent: "center", paddingVertical: space.xs } as const;
