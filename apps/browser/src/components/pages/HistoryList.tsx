import { type ReactNode, useCallback, useRef, useState } from "react";
import { type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, ScrollView, View } from "react-native";
import { assignSlots, historyScroll, rowAt, type Layout } from "./historyLayout";
import { DayHeader, HistoryRow } from "./HistoryRow";
import { PAGE_WIDTH } from "./PageLayout";
import { historyRow, pageList } from "./tokens";

const ROW = historyRow.height;
const HEADER = historyRow.header;

export function HistoryList({
  layout,
  profileId,
  windowId,
  selected,
  onToggle,
  onMoreFromSite,
  onRemove,
}: {
  layout: Layout;
  profileId: string;
  windowId: string;
  selected: Set<string>;
  onToggle: (url: string, shift: boolean) => void;
  onMoreFromSite: (url: string) => void;
  onRemove: (url: string) => void;
}) {
  const { rows, days } = layout;
  const [viewport, setViewport] = useState(800);
  const overscan = Math.round(viewport / 2);
  const rowPool = Math.ceil((viewport + 2 * overscan) / ROW) + 1;
  const dayPool = Math.ceil((viewport + 2 * overscan + ROW) / (HEADER + ROW)) + 2;

  const scrollY = useRef(0);
  const [, rerender] = useState(0);
  const band = rowAt(rows, scrollY.current - overscan);
  const rendered = useRef({ rows, overscan, band });
  rendered.current = { rows, overscan, band };
  const [onScroll] = useState(() => (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
    historyScroll.lastAt = Date.now();
    const { rows, overscan, band } = rendered.current;
    if (rowAt(rows, scrollY.current - overscan) !== band) rerender((n) => n + 1);
  });
  const onLayout = useCallback((e: LayoutChangeEvent) => setViewport(Math.max(ROW, Math.round(e.nativeEvent.layout.height))), []);

  const top = Math.min(band, rows.length - 1);
  const rowCount = Math.min(rowPool, rows.length);
  const firstRow = Math.max(0, Math.min(top, rows.length - rowCount));
  const dayCount = Math.min(dayPool, days.length);
  const firstDay = Math.max(0, Math.min(rows[top]!.day, days.length - dayCount));
  const selecting = selected.size > 0;

  const rowSlots = useRef(new Map<string, number>());
  rowSlots.current = assignSlots(rows.slice(firstRow, firstRow + rowCount).map((r) => r.entry.url), rowSlots.current);

  const slots: ReactNode[] = new Array(dayCount + rowCount);
  for (let i = firstDay; i < firstDay + dayCount; i++) {
    const slot = i % dayPool;
    slots[slot] = <DayHeader key={`d${slot}`} label={days[i]!.label} top={days[i]!.offset} />;
  }
  for (let i = firstRow; i < firstRow + rowCount; i++) {
    const row = rows[i]!;
    const slot = rowSlots.current.get(row.entry.url)!;
    slots[dayCount + slot] = (
      <View key={`r${slot}`} style={{ position: "absolute", top: row.offset, left: 0, right: 0, height: ROW }}>
        <HistoryRow
          entry={row.entry}
          profileId={profileId}
          first={row.first}
          last={row.last}
          selected={selected.has(row.entry.url)}
          selecting={selecting}
          windowId={windowId}
          onToggle={onToggle}
          onMoreFromSite={onMoreFromSite}
          onRemove={onRemove}
        />
      </View>
    );
  }

  return (
    <ScrollView onLayout={onLayout} onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={LIST}>
      <View style={{ width: PAGE_WIDTH, maxWidth: "100%", height: layout.height }}>{slots}</View>
    </ScrollView>
  );
}

const LIST = { paddingBottom: pageList.endPad, alignItems: "center" } as const;
