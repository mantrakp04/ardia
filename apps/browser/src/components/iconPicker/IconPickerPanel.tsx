import { useMemo, useState } from "react";
import { Animated, Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { Button, Panel, radius, SearchField, space, usePopoverMotion, usePopoverMotionStyle } from "../ui";
import { useTheme } from "../ui/theme";
import { iconSymbol, symbolIcon } from "../../lib/customIcon";
import { emojiSections, matchesTerms, searchEmoji, searchTerms } from "../../lib/emoji";
import { IconGrid, type GridSection } from "./IconGrid";
import { ICON_PICKER, ICON_PICKER_SHADOW, ICON_PICKER_WIDTH } from "./tokens";

export type PickerSymbol = { name: string; title?: string };
export type PickerAction = { title: string; icon?: string; primary?: boolean; onPress: () => void };
export type PickerPlace = { top: number; left: number; upward?: boolean };

type Tab = "emoji" | "symbols";

const TABS: { tab: Tab; icon: string; title: string }[] = [
  { tab: "emoji", icon: "face.smiling", title: "Emoji" },
  { tab: "symbols", icon: "star.square.on.square", title: "Symbols" },
];

const SECTION_SYMBOLS: Record<string, string> = {
  Smileys: "face.smiling",
  People: "person",
  "Animals & Nature": "pawprint",
  "Food & Drink": "fork.knife",
  Activities: "soccerball",
  "Travel & Places": "car",
  Objects: "lightbulb",
  Symbols: "heart",
  Flags: "flag",
};

let allEmoji: GridSection[] | null = null;

const emojiGrid = () =>
  (allEmoji ??= emojiSections().map((s) => ({
    title: s.title,
    symbol: SECTION_SYMBOLS[s.title],
    icons: s.emoji.map((e) => ({ icon: e.emoji, label: e.name })),
  })));

function pickerSections(tab: Tab, terms: string[], symbols: PickerSymbol[]): GridSection[] {
  if (tab === "symbols") {
    const shown = terms.length ? symbols.filter((s) => matchesTerms(`${s.name} ${s.title ?? ""}`, terms)) : symbols;
    return [{ title: null, icons: shown.map((s) => ({ icon: symbolIcon(s.name), label: s.title ?? s.name })) }];
  }
  if (terms.length) return [{ title: null, icons: searchEmoji(terms).map((e) => ({ icon: e.emoji, label: e.name })) }];
  return emojiGrid();
}

type PanelProps = {
  current: string | null;
  symbols: PickerSymbol[];
  actions: PickerAction[];
  onChoose: (icon: string) => void;
  onClose: () => void;
  place: PickerPlace | null;
  onSize: (height: number) => void;
};

function IconPickerPanel({ current, symbols, actions, onChoose, onClose, place, onSize }: PanelProps) {
  const theme = useTheme();
  const [tab, setTab] = useState<Tab>(iconSymbol(current) ? "symbols" : "emoji");
  const [query, setQuery] = useState("");
  const terms = useMemo(() => searchTerms(query), [query]);
  const sections = useMemo(() => pickerSections(tab, terms, symbols), [tab, terms, symbols]);
  const appear = usePopoverMotion(false, undefined, !!place);
  const motion = usePopoverMotionStyle(appear, place?.upward ? "bottom" : "top", place?.upward);
  const onLayout = (e: LayoutChangeEvent) => onSize(e.nativeEvent.layout.height);

  return (
    <Animated.View
      pointerEvents={place ? "auto" : "none"}
      style={[{ position: "absolute", top: place?.top ?? 0, left: place?.left ?? 0, width: ICON_PICKER_WIDTH }, place ? motion : HIDDEN]}
      onLayout={onLayout}
    >
      <Panel fill={theme.panel} radius={radius.sheet} border={theme.panelBorder} shadow={ICON_PICKER_SHADOW} style={PANEL}>
        <View style={TOP_ROW}>
          <View style={FILL}>
            <SearchField
              autoFocus
              width="100%"
              value={query}
              onChangeText={setQuery}
              placeholder={tab === "emoji" ? "Search emoji" : "Search symbols"}
              onEscape={onClose}
              onSubmit={() => {
                if (!terms.length) return;
                const first = sections.find((s) => s.icons.length)?.icons[0];
                if (first) onChoose(first.icon);
              }}
            />
          </View>
          {TABS.map((t) => (
            <Button key={t.tab} variant="icon" icon={t.icon} active={tab === t.tab} tooltip={t.title} onPress={() => setTab(t.tab)} />
          ))}
        </View>
        <IconGrid sections={sections} current={current} onChoose={onChoose} scrollKey={`${tab}|${terms.join(" ")}`} />
        {actions.length ? (
          <View style={TOP_ROW}>
            {actions.map((a) => (
              <View key={a.title} style={FILL}>
                <Button variant="pill" tone="chip" icon={a.icon} primary={a.primary} title={a.title} onPress={a.onPress} />
              </View>
            ))}
          </View>
        ) : null}
      </Panel>
    </Animated.View>
  );
}

type Room = { width: number; height: number };
type Anchor = { x: number; y: number; width: number; height: number };

export function IconPickerLayer({
  placeIn,
  onClose,
  ...panel
}: Omit<PanelProps, "place" | "onSize"> & { placeIn: (height: number, room: Room) => PickerPlace }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  return (
    <>
      <Pressable
        onPress={onClose}
        style={StyleSheet.absoluteFill}
        onLayout={(e) => setRoom({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      />
      <IconPickerPanel {...panel} onClose={onClose} place={room && height !== null ? placeIn(height, room) : null} onSize={setHeight} />
    </>
  );
}

export const nearAnchor =
  (anchor: Anchor | null) =>
  (height: number, room: Room): PickerPlace => {
    const { anchorGap, windowMargin } = ICON_PICKER;
    const box = anchor ?? { x: room.width / 2, y: windowMargin, width: 0, height: 0 };
    const below = box.y + box.height + anchorGap;
    const above = box.y - anchorGap - height;
    const upward = below + height > room.height - windowMargin && above >= windowMargin;
    const top = upward ? above : Math.max(windowMargin, Math.min(below, room.height - windowMargin - height));
    return { top, left: clampLeft(box.x + box.width / 2 - ICON_PICKER_WIDTH / 2, room), upward };
  };

export const clampLeft = (left: number, room: Room) =>
  Math.max(ICON_PICKER.windowMargin, Math.min(left, room.width - ICON_PICKER.windowMargin - ICON_PICKER_WIDTH));

export const clampTop = (top: number, height: number, room: Room) =>
  Math.max(ICON_PICKER.windowMargin, Math.min(top, room.height - ICON_PICKER.windowMargin - height));

const HIDDEN = { opacity: 0 } as const;
const PANEL = { padding: ICON_PICKER.pad, gap: space.m } as const;
const TOP_ROW = { flexDirection: "row", alignItems: "center", gap: space.s } as const;
const FILL = { flex: 1 } as const;
