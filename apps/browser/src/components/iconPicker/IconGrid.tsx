import { memo, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { Button, iconButton, radius, space, Symbol, Text } from "../ui";
import { useTheme } from "../ui/theme";
import { iconSymbol } from "../../lib/customIcon";
import { sameIcon } from "../../lib/emoji";
import { ICON_PICKER, iconPickerColors } from "./tokens";

export type GridIcon = { icon: string; label: string };
export type GridSection = { title: string | null; symbol?: string; icons: GridIcon[] };
type GridRow = { key: string; title: string } | { key: string; icons: GridIcon[] };

const GRID_HEIGHT = ICON_PICKER.rows * ICON_PICKER.cell;
const GRID_WIDTH = ICON_PICKER.columns * ICON_PICKER.cell;
const rowHeight = (row: GridRow) => ("title" in row ? ICON_PICKER.header : ICON_PICKER.cell);

function gridRows(sections: GridSection[]): GridRow[] {
  const rows: GridRow[] = [];
  for (const { title, icons } of sections) {
    if (title) rows.push({ key: `title:${title}`, title });
    for (let i = 0; i < icons.length; i += ICON_PICKER.columns) rows.push({ key: `${title ?? ""}:${i}`, icons: icons.slice(i, i + ICON_PICKER.columns) });
  }
  return rows;
}

export function IconGrid({
  sections,
  current,
  onChoose,
  scrollKey,
}: {
  sections: GridSection[];
  current: string | null;
  onChoose: (icon: string) => void;
  scrollKey: string;
}) {
  const list = useRef<FlatList<GridRow>>(null);
  const rows = useMemo(() => gridRows(sections), [sections]);
  const offsets = useMemo(() => {
    let y = 0;
    return rows.map((row) => {
      const offset = y;
      y += rowHeight(row);
      return offset;
    });
  }, [rows]);
  const [initialRow] = useState(() => rows.findIndex((row) => "icons" in row && row.icons.some((i) => sameIcon(i.icon, current))));
  const scrolledFor = useRef(scrollKey);
  useEffect(() => {
    if (scrolledFor.current === scrollKey) return;
    scrolledFor.current = scrollKey;
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }, [scrollKey]);
  const headers = useMemo(() => rows.flatMap((row, i) => ("title" in row ? [offsets[i] ?? 0] : [])), [rows, offsets]);
  const [shownSection, setShownSection] = useState(0);
  const jumps = sections.length > 1 ? sections : [];
  const onScroll = (y: number) => {
    const at = headers.reduce((last, offset, i) => (offset <= y + 1 ? i : last), 0);
    if (at !== shownSection) setShownSection(at);
  };
  const choose = useRef(onChoose);
  choose.current = onChoose;
  const press = useMemo(() => (icon: string) => choose.current(icon), []);

  return (
    <>
      <FlatList
        ref={list}
        data={rows}
        extraData={current}
        keyExtractor={(row) => row.key}
        getItemLayout={(_, index) => ({ length: rows[index] ? rowHeight(rows[index]) : 0, offset: offsets[index] ?? 0, index })}
        initialScrollIndex={initialRow > 1 ? initialRow - 1 : undefined}
        initialNumToRender={ICON_PICKER.rows + 2}
        maxToRenderPerBatch={ICON_PICKER.rows * 2}
        windowSize={5}
        style={jumps.length ? GRID : GRID_WITHOUT_JUMPS}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => onScroll(e.nativeEvent.contentOffset.y)}
        renderItem={({ item }) =>
          "title" in item ? (
            <Text size="caption" weight="semibold" tone="textSecondary" style={HEADER}>
              {item.title}
            </Text>
          ) : (
            <View style={ROW}>
              {item.icons.map((i) => (
                <Cell key={i.icon} icon={i.icon} label={i.label} selected={sameIcon(i.icon, current)} onPress={press} />
              ))}
            </View>
          )
        }
        ListEmptyComponent={
          <Text size="small" tone="textTertiary" style={NO_MATCHES}>
            No matches
          </Text>
        }
      />
      {jumps.length ? (
        <View style={JUMPS}>
          {jumps.map((s, i) => (
            <Button
              key={s.title}
              variant="icon"
              size="m"
              icon={s.symbol}
              active={i === shownSection}
              tooltip={s.title ?? undefined}
              onPress={() => list.current?.scrollToOffset({ offset: headers[i] ?? 0, animated: false })}
            />
          ))}
        </View>
      ) : null}
    </>
  );
}

const Cell = memo(function Cell({ icon, label, selected, onPress }: { icon: string; label: string; selected: boolean; onPress: (icon: string) => void }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const symbol = iconSymbol(icon);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={() => onPress(icon)}>
      <View
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={[CELL, hovered || selected ? { backgroundColor: iconPickerColors(theme.dark).cellHover } : null]}
      >
        {symbol ? <Symbol name={symbol} size={ICON_PICKER.symbol} color={theme.icon} style={SYMBOL} /> : <Text style={EMOJI}>{icon}</Text>}
      </View>
    </Pressable>
  );
});

const GRID = { width: GRID_WIDTH, height: GRID_HEIGHT, flexGrow: 0, alignSelf: "center" } as const;
const GRID_WITHOUT_JUMPS = { ...GRID, height: GRID_HEIGHT + iconButton.m.box + space.m } as const;
const ROW = { flexDirection: "row", height: ICON_PICKER.cell } as const;
const HEADER = { height: ICON_PICKER.header, paddingTop: space.ml, paddingLeft: space.xs } as const;
const CELL = { width: ICON_PICKER.cell, height: ICON_PICKER.cell, borderRadius: radius.tile, alignItems: "center", justifyContent: "center" } as const;
const SYMBOL = { width: ICON_PICKER.symbolBox, height: ICON_PICKER.symbolBox } as const;
const EMOJI = { width: ICON_PICKER.cell, textAlign: "center", fontSize: ICON_PICKER.emoji } as const;
const NO_MATCHES = { padding: space.m } as const;
const JUMPS = { width: GRID_WIDTH, alignSelf: "center", flexDirection: "row", justifyContent: "space-between" } as const;
