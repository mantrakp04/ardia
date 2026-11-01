import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Button, Panel, radius, SearchField, space, Symbol, Text } from "../ui";
import { useTheme } from "../ui/theme";
import { useLive } from "../../state/live/store";
import { setIcon } from "../../state/sidebar/actions";
import { setSidebarUi, useSidebarUi } from "../../state/sidebar/sidebarUi";
import { useIconPickerCurrent } from "../../state/sidebar/hooks";
import { NO_GROUP_ICON } from "../../state/groups/groupIcons";
import { iconSymbol, symbolIcon } from "../../lib/customIcon";
import { SIDEBAR_SHADOW, SIDEBAR_TYPE, useSidebarTokens } from "./tokens";

const EMOJI: [string, string][] = [
  ["⭐️", "star favorite"], ["🔥", "fire hot"], ["❤️", "heart love"], ["✅", "check done"], ["📌", "pin"], ["🚀", "rocket launch ship"],
  ["💡", "idea bulb"], ["📝", "note memo write"], ["📚", "books read study"], ["📖", "book read"], ["🎓", "school graduate"], ["💼", "work briefcase"],
  ["🏠", "home house"], ["🛒", "shopping cart"], ["💰", "money"], ["💳", "card pay"], ["📈", "chart growth stocks"], ["📊", "chart data"],
  ["🗓️", "calendar date"], ["⏰", "alarm time"], ["📧", "email mail"], ["💬", "chat message"], ["📞", "phone call"], ["🎥", "video camera"],
  ["🎵", "music song"], ["🎧", "headphones music"], ["🎮", "game play"], ["🎨", "art design paint"], ["📷", "photo camera"], ["🎬", "movie film"],
  ["📺", "tv watch"], ["🍿", "popcorn movie"], ["✈️", "travel plane"], ["🗺️", "map travel"], ["🏖️", "beach holiday"], ["🌍", "world earth globe"],
  ["🍕", "pizza food"], ["🍔", "burger food"], ["☕️", "coffee"], ["🍷", "wine"], ["🍎", "apple fruit"], ["🥗", "salad food healthy"],
  ["🏋️", "gym fitness"], ["⚽️", "football soccer sport"], ["🏀", "basketball sport"], ["🚴", "bike cycling"], ["🧘", "yoga calm"], ["💊", "health pill"],
  ["🐶", "dog pet"], ["🐱", "cat pet"], ["🦊", "fox"], ["🐼", "panda"], ["🦄", "unicorn"], ["🐙", "octopus github"],
  ["🌱", "plant grow"], ["🌸", "flower blossom"], ["🌈", "rainbow"], ["☀️", "sun"], ["🌙", "moon night"], ["❄️", "snow cold"],
  ["⚡️", "lightning fast"], ["💎", "gem diamond"], ["🎁", "gift present"], ["🎉", "party celebrate"], ["🏆", "trophy win"], ["🎯", "target goal"],
  ["🧠", "brain think"], ["👀", "eyes look"], ["🤖", "robot ai bot"], ["👾", "alien game"], ["💻", "laptop computer code"], ["🖥️", "desktop computer"],
  ["⌨️", "keyboard type"], ["🛠️", "tools build"], ["⚙️", "settings gear"], ["🔧", "wrench fix"], ["🧪", "test lab science"], ["🔬", "science research"],
  ["🐛", "bug"], ["🔒", "lock secure"], ["🔑", "key"], ["🧩", "puzzle extension"], ["📦", "package box"], ["🗂️", "folder files"],
  ["📁", "folder"], ["🗃️", "archive"], ["📰", "news paper"], ["🔗", "link"], ["🔍", "search find"], ["🧭", "compass explore"],
  ["🏷️", "tag label"], ["💭", "thought"], ["❓", "question"], ["❗️", "important"], ["⚠️", "warning"], ["🚧", "construction wip"],
  ["🟥", "red square"], ["🟧", "orange square"], ["🟨", "yellow square"], ["🟩", "green square"], ["🟦", "blue square"], ["🟪", "purple square"],
  ["🔴", "red circle"], ["🟠", "orange circle"], ["🟡", "yellow circle"], ["🟢", "green circle"], ["🔵", "blue circle"], ["🟣", "purple circle"],
];

const SYMBOLS = [
  "star", "heart", "bookmark", "flag", "pin", "bolt", "flame", "leaf", "globe", "house", "briefcase", "cart", "bag", "creditcard",
  "dollarsign.circle", "chart.bar", "chart.line.uptrend.xyaxis", "calendar", "clock", "alarm", "envelope", "bubble.left", "phone", "video",
  "music.note", "headphones", "gamecontroller", "paintbrush", "camera", "film", "tv", "airplane", "map", "car", "fork.knife", "cup.and.saucer",
  "figure.run", "sportscourt", "pawprint", "tree", "sun.max", "moon", "cloud", "snowflake", "sparkles", "gift", "trophy", "target", "brain",
  "eye", "laptopcomputer", "desktopcomputer", "keyboard", "hammer", "wrench.and.screwdriver", "gearshape", "testtube.2", "ant", "lock",
  "key", "puzzlepiece", "shippingbox", "folder", "archivebox", "newspaper", "link", "magnifyingglass", "safari", "tag", "lightbulb",
  "questionmark.circle", "exclamationmark.triangle", "book", "graduationcap", "doc.text", "list.bullet", "checkmark.circle", "person.2",
];

const COLUMNS = 8;
const CELL = 30;
const PAD = space.m;
const WIDTH = COLUMNS * CELL + PAD * 2;
const FILL = { flex: 1 } as const;
const NO_MATCHES = { padding: space.m } as const;
const EMOJI_TEXT = { fontSize: SIDEBAR_TYPE.emoji } as const;

export function IconPicker({ windowId, sidebarWidth }: { windowId: string; sidebarWidth: number }) {
  const picker = useSidebarUi((u) => (u.iconPicker?.windowId === windowId ? u.iconPicker : null));
  return picker ? <PickerPanel key={picker.id} picker={picker} sidebarWidth={sidebarWidth} /> : null;
}

type Picker = NonNullable<ReturnType<typeof useSidebarUi.getState>["iconPicker"]>;

function PickerPanel({ picker, sidebarWidth }: { picker: Picker; sidebarWidth: number }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const liveIcon = useLive((s) => (picker.kind === "live" ? s.folders[picker.id.split("|")[1] ?? ""]?.icon : null));
  const current = useIconPickerCurrent(picker.kind, picker.id, liveIcon);
  const [tab, setTab] = useState<"emoji" | "symbols">(iconSymbol(current) ? "symbols" : "emoji");
  const [query, setQuery] = useState("");
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tab === "emoji"
      ? EMOJI.filter(([, words]) => !q || words.includes(q)).map(([e]) => e)
      : SYMBOLS.filter((name) => !q || name.includes(q)).map(symbolIcon);
  }, [tab, query]);
  const close = () => setSidebarUi({ iconPicker: null });
  const choose = (icon: string | null) => {
    setIcon(picker, icon);
    close();
  };
  const top = Math.max(8, (picker.anchor?.y ?? 60) - 8);
  const left = picker.anchor ? Math.max(8, Math.min(sidebarWidth + 6, picker.anchor.x + picker.anchor.width + 6)) : sidebarWidth + 6;

  return (
    <>
      <Pressable onPress={close} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
      <Panel
        fill={theme.panel}
        radius={radius.sheet}
        border={theme.panelBorder}
        shadow={SIDEBAR_SHADOW.iconPicker}
        style={{ position: "absolute", top, left, width: WIDTH, padding: PAD, gap: space.m }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.s }}>
          <View style={FILL}>
            <SearchField
              autoFocus
              width="100%"
              value={query}
              onChangeText={setQuery}
              placeholder={tab === "emoji" ? "Search emoji" : "Search icons"}
              onEscape={close}
              onSubmit={() => items[0] && choose(items[0])}
            />
          </View>
          {(["emoji", "symbols"] as const).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)}>
              <View style={{ width: 28, height: 26, borderRadius: radius.tile, alignItems: "center", justifyContent: "center", backgroundColor: tab === t ? tokens.pickerCellHover : undefined }}>
                <Symbol name={t === "emoji" ? "face.smiling" : "star.square.on.square"} size={13} color={theme.icon} style={{ width: 16, height: 16 }} />
              </View>
            </Pressable>
          ))}
        </View>
        <ScrollView style={{ maxHeight: CELL * 6 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {items.map((icon) => (
              <Cell key={icon} icon={icon} selected={icon === current} onPress={() => choose(icon)} />
            ))}
            {items.length === 0 ? (
              <Text size="small" tone="textTertiary" style={NO_MATCHES}>
                No matches
              </Text>
            ) : null}
          </View>
        </ScrollView>
        {picker.kind === "group" || current ? (
          <View style={{ flexDirection: "row", gap: space.s }}>
            {picker.kind === "group" ? (
              <View style={FILL}>
                <Button variant="pill" tone="chip" icon="square.stack.fill" primary={current === NO_GROUP_ICON} title="No Icon" onPress={() => choose(NO_GROUP_ICON)} />
              </View>
            ) : null}
            {current ? (
              <View style={FILL}>
                <Button variant="pill" tone="chip" title="Reset Icon" onPress={() => choose(null)} />
              </View>
            ) : null}
          </View>
        ) : null}
      </Panel>
    </>
  );
}

function Cell({ icon, selected, onPress }: { icon: string; selected: boolean; onPress(): void }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const [hovered, setHovered] = useState(false);
  const symbol = iconSymbol(icon);
  return (
    <Pressable onPress={onPress}>
      <View
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          width: CELL,
          height: CELL,
          borderRadius: radius.tile,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: hovered || selected ? tokens.pickerCellHover : undefined,
        }}
      >
        {symbol ? (
          <Symbol name={symbol} size={15} color={theme.icon} style={{ width: 20, height: 20 }} />
        ) : (
          <Text style={EMOJI_TEXT}>{icon}</Text>
        )}
      </View>
    </Pressable>
  );
}
