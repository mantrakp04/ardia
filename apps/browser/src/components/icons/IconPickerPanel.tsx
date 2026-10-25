import { Symbol } from "@ardia/shell";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { useSidebarTokens } from "../sidebar/tokens";
import { classifyIcon, NO_GROUP_ICON, NO_GROUP_ICON_INK, SYMBOL_PREFIX } from "./classify";
import { GLYPHS } from "./glyphs";
import { IconGlyph } from "./IconGlyph";
import { EMOJI, PROFILE_SYMBOLS, SYMBOLS } from "./iconSets";

const COLUMNS = 8;
const CELL = 30;
const MAX_ROWS = 6;
export const ICON_PICKER_WIDTH = COLUMNS * CELL + 16;

export type IconTargetKind = "tab" | "group" | "live" | "profile";
type Tab = "emoji" | "symbols" | "glyphs";

const TABS: { id: Tab; symbol: string; title: string }[] = [
  { id: "emoji", symbol: "face.smiling", title: "Emoji" },
  { id: "symbols", symbol: "star.square.on.square", title: "Icons" },
  { id: "glyphs", symbol: "character", title: "Glyphs" },
];

const resetTitle = (kind: IconTargetKind) => (kind === "profile" ? "Use Initial" : "Reset Icon");

export function IconPickerPanel({
  current,
  kind,
  onPick,
  onClose,
  width = ICON_PICKER_WIDTH,
  autoFocus = true,
}: {
  current: string | null;
  kind: IconTargetKind;
  onPick(icon: string | null): void;
  onClose(): void;
  width?: number;
  autoFocus?: boolean;
}) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const classified = classifyIcon(current);
  const [tab, setTab] = useState<Tab>(classified.kind === "symbol" ? "symbols" : classified.kind === "glyph" ? "glyphs" : "emoji");
  const [query, setQuery] = useState("");
  const typed = query.trim();
  const typedKind = typed ? classifyIcon(typed).kind : "initial";
  const direct = typed && (typedKind === "emoji" || typedKind === "glyph") ? typed : null;
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (tab === "emoji") return EMOJI.filter(([, words]) => !q || words.includes(q)).map(([char]) => char);
    if (tab === "glyphs") return GLYPHS.filter((glyph) => !q || glyph.words.includes(q) || glyph.char === q).map((glyph) => glyph.char);
    const titles = new Map(PROFILE_SYMBOLS.map((symbol) => [symbol.name, symbol.title.toLowerCase()]));
    return [...new Set([...SYMBOLS, ...PROFILE_SYMBOLS.map((symbol) => symbol.name)])]
      .filter((name) => !q || name.includes(q) || (titles.get(name) ?? "").includes(q))
      .map((name) => SYMBOL_PREFIX + name);
  }, [tab, query]);
  const shown = direct && !items.includes(direct) ? [direct, ...items] : items;

  const submit = () => {
    if (direct) onPick(direct);
    else if (items[0]) onPick(items[0]);
  };

  return (
    <View style={{ width, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ flex: 1, height: 26, borderRadius: 8, backgroundColor: theme.urlPill, flexDirection: "row", alignItems: "center", paddingHorizontal: 7 }}>
          <Symbol name="magnifyingglass" size={11} color={theme.textSecondary} style={{ width: 14, height: 14 }} />
          <TextInput
            autoFocus={autoFocus}
            value={query}
            onChangeText={setQuery}
            placeholder={tab === "emoji" ? "Search emoji" : tab === "symbols" ? "Search icons" : "Search or type a glyph"}
            placeholderTextColor={theme.placeholder}
            enableFocusRing={false}
            keyDownEvents={[{ key: "Escape" }]}
            onKeyDown={(e) => e.nativeEvent.key === "Escape" && onClose()}
            onSubmitEditing={submit}
            style={{ flex: 1, fontSize: 12, marginLeft: 5, color: theme.textPrimary, paddingVertical: 0 }}
          />
        </View>
        {TABS.map((t) => (
          <Pressable key={t.id} onPress={() => setTab(t.id)} tooltip={t.title}>
            <View style={{ width: 28, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: tab === t.id ? tokens.pickerCellHover : undefined }}>
              <Symbol name={t.symbol} size={13} color={theme.icon} style={{ width: 16, height: 16 }} />
            </View>
          </Pressable>
        ))}
      </View>
      <ScrollView style={{ maxHeight: CELL * MAX_ROWS }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {shown.map((icon) => (
            <Cell key={icon} icon={icon} selected={icon === current} onPress={() => onPick(icon)} />
          ))}
          {shown.length === 0 ? <Text style={{ padding: 8, fontSize: 12, color: theme.textTertiary }}>No matches</Text> : null}
        </View>
      </ScrollView>
      {kind === "group" || current ? (
        <View style={{ flexDirection: "row", gap: 6 }}>
          {kind === "group" ? (
            <FooterButton label="No Icon" selected={current === NO_GROUP_ICON} onPress={() => onPick(NO_GROUP_ICON)}>
              <Symbol
                name="square.stack.fill"
                size={11}
                weight="medium"
                color={theme.dark ? NO_GROUP_ICON_INK.dark : NO_GROUP_ICON_INK.light}
                style={{ width: 14, height: 14 }}
              />
            </FooterButton>
          ) : null}
          {current ? <FooterButton label={resetTitle(kind)} selected={false} onPress={() => onPick(null)} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function FooterButton({ label, selected, onPress, children }: { label: string; selected: boolean; onPress(): void; children?: ReactNode }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} style={{ flex: 1 }}>
      {({ pressed }) => (
        <View
          style={{
            height: 26,
            borderRadius: 8,
            flexDirection: "row",
            gap: 5,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed || selected ? tokens.pickerCellHover : theme.urlPill,
          }}
        >
          {children}
          <Text style={{ fontSize: 12, color: theme.textPrimary }}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

function Cell({ icon, selected, onPress }: { icon: string; selected: boolean; onPress(): void }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable onPress={onPress}>
      <View
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          width: CELL,
          height: CELL,
          borderRadius: 8,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: hovered || selected ? tokens.pickerCellHover : undefined,
        }}
      >
        <IconGlyph icon={icon} size={18} color={theme.icon} />
      </View>
    </Pressable>
  );
}
