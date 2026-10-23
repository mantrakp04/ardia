import { Surface, Symbol } from "@ardia/shell";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { hex, useTheme } from "../../lib/theme";
import { useLive } from "../../live/store";
import { useBrowser } from "../../store/browser";
import { setIcon } from "./actions";
import { setSidebarUi, useSidebarUi } from "./state";
import { SYMBOL_PREFIX } from "./TabIcon";

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

const SYMBOLS: [string, string, string?][] = [
  ["star", "Star", "favorite"], ["heart", "Heart", "love"], ["bookmark", "Bookmark", "saved"], ["flag", "Flag"],
  ["pin", "Pin"], ["bolt", "Lightning", "fast bolt"], ["flame", "Flame", "fire hot"], ["leaf", "Leaf", "nature plant"],
  ["globe", "Globe", "world earth"], ["house", "Home", "house"], ["briefcase", "Briefcase", "work"], ["cart", "Shopping cart"], ["bag", "Shopping bag"],
  ["creditcard", "Credit card", "payment"], ["dollarsign.circle", "Money", "dollar finance"], ["chart.bar", "Bar chart", "data"],
  ["chart.line.uptrend.xyaxis", "Growth chart", "stocks trend finance"], ["calendar", "Calendar", "date"], ["clock", "Clock", "time"], ["alarm", "Alarm"],
  ["envelope", "Mail", "email envelope"], ["bubble.left", "Chat", "message conversation"], ["phone", "Phone", "call"], ["video", "Video"],
  ["music.note", "Music", "song"], ["headphones", "Headphones", "music audio"], ["gamecontroller", "Games", "play controller"],
  ["paintbrush", "Paintbrush", "art design"], ["camera", "Camera", "photo"], ["film", "Film", "movie"], ["tv", "TV", "television watch"],
  ["airplane", "Airplane", "travel flight"], ["map", "Map", "travel"], ["car", "Car", "drive"], ["fork.knife", "Food", "restaurant dining"],
  ["cup.and.saucer", "Coffee", "cup tea"], ["figure.run", "Running", "fitness gym exercise"], ["sportscourt", "Sports", "court"],
  ["pawprint", "Pets", "animal paw"], ["tree", "Tree", "nature"], ["sun.max", "Sun", "day weather"], ["moon", "Moon", "night"],
  ["cloud", "Cloud", "weather"], ["snowflake", "Snowflake", "snow cold"], ["sparkles", "Sparkles"], ["gift", "Gift", "present"],
  ["trophy", "Trophy", "win award"], ["target", "Target", "goal"], ["brain", "Brain", "think"], ["eye", "Eye", "look"],
  ["laptopcomputer", "Laptop", "computer code"], ["desktopcomputer", "Desktop", "computer monitor"], ["keyboard", "Keyboard", "type"],
  ["hammer", "Hammer", "tools build"], ["wrench.and.screwdriver", "Tools", "fix repair"], ["gearshape", "Settings", "gear"],
  ["testtube.2", "Science", "test lab research"], ["ant", "Bug", "ant insect"], ["lock", "Lock", "secure privacy"], ["key", "Key"],
  ["puzzlepiece", "Puzzle", "extension"], ["shippingbox", "Package", "box shipping"], ["folder", "Folder", "files"],
  ["archivebox", "Archive", "storage"], ["newspaper", "News", "paper"], ["link", "Link"], ["magnifyingglass", "Search", "find"],
  ["safari", "Compass", "explore browser"], ["tag", "Tag", "label"], ["lightbulb", "Idea", "light bulb"],
  ["questionmark.circle", "Question", "help"], ["exclamationmark.triangle", "Warning", "important"], ["book", "Book", "read study"],
  ["graduationcap", "Education", "school study graduate"], ["doc.text", "Document", "note write"], ["list.bullet", "List", "tasks"],
  ["checkmark.circle", "Checkmark", "done complete"], ["person.2", "People", "team group"],
];

const COLUMNS = 8;
const CELL = 34;
const SCROLLBAR_GUTTER = 16;
const WIDTH = COLUMNS * CELL + 24 + SCROLLBAR_GUTTER;

type IconOption = { value: string; label: string; keywords: string };
type PickerTab = "symbols" | "emoji";

const ICON_OPTIONS: Record<PickerTab, IconOption[]> = {
  symbols: SYMBOLS.map(([name, label, keywords = ""]) => ({ value: SYMBOL_PREFIX + name, label, keywords: `${name} ${keywords}` })),
  emoji: EMOJI.map(([value, words]) => ({ value, label: words[0]!.toUpperCase() + words.slice(1), keywords: words })),
};

export function IconPicker({ windowId, sidebarWidth }: { windowId: string; sidebarWidth: number }) {
  const picker = useSidebarUi((u) => (u.iconPicker?.windowId === windowId ? u.iconPicker : null));
  return picker ? <PickerPanel key={picker.id} picker={picker} sidebarWidth={sidebarWidth} /> : null;
}

type Picker = NonNullable<ReturnType<typeof useSidebarUi.getState>["iconPicker"]>;

function PickerPanel({ picker, sidebarWidth }: { picker: Picker; sidebarWidth: number }) {
  const theme = useTheme();
  const liveIcon = useLive((s) => (picker.kind === "live" ? s.folders[picker.id.split("|")[1] ?? ""]?.icon : null));
  const current = useBrowser((s) => (picker.kind === "tab" ? s.tabs[picker.id]?.customIcon : picker.kind === "live" ? liveIcon : s.groups[picker.id]?.icon) ?? null);
  const [tab, setTab] = useState<PickerTab>(current && !current.startsWith(SYMBOL_PREFIX) ? "emoji" : "symbols");
  const [query, setQuery] = useState("");
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ICON_OPTIONS[tab].filter(({ value, label, keywords }) => !q || `${label} ${keywords} ${tab === "emoji" ? value : ""}`.toLowerCase().includes(q));
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
      <Surface
        fill={hex(theme.panel)}
        cornerRadius={14}
        borderColor={hex(theme.panelBorder)}
        borderWidth={0.5}
        shadowColor="#000000"
        shadowOpacity={theme.panelShadowOpacity}
        shadowRadius={20}
        shadowOffset={[0, 8]}
        style={{ position: "absolute", top, left, width: WIDTH, padding: 12, gap: 10 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: theme.textPrimary }}>Edit icon</Text>
          <View style={{ flexDirection: "row", padding: 2, borderRadius: 8, backgroundColor: theme.urlPill }}>
            <ModeButton label="Icons" selected={tab === "symbols"} onPress={() => setTab("symbols")} />
            <ModeButton label="Emoji" selected={tab === "emoji"} onPress={() => setTab("emoji")} />
          </View>
        </View>
        <View style={{ height: 30, borderRadius: 8, backgroundColor: theme.urlPill, flexDirection: "row", alignItems: "center", paddingHorizontal: 9 }}>
          <Symbol name="magnifyingglass" size={12} color={theme.icon} style={{ width: 14, height: 14 }} />
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            accessibilityLabel={tab === "emoji" ? "Search emoji" : "Search icons"}
            placeholder={tab === "emoji" ? "Search emoji" : "Search icons"}
            placeholderTextColor={theme.dark ? "#FFFFFFB3" : "#00000099"}
            selectionColor={theme.selection}
            enableFocusRing={false}
            keyDownEvents={[{ key: "Escape" }]}
            onKeyDown={(e) => e.nativeEvent.key === "Escape" && close()}
            onSubmitEditing={() => items[0] && choose(items[0].value)}
            style={{ flex: 1, fontSize: 12, marginLeft: 7, color: theme.textPrimary, paddingVertical: 0 }}
          />
        </View>
        <ScrollView key={tab} style={{ maxHeight: CELL * 6 }} showsVerticalScrollIndicator>
          {items.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {items.map((item) => (
                <Cell key={item.value} item={item} selected={item.value === current} onPress={() => choose(item.value)} />
              ))}
            </View>
          ) : (
            <View style={{ minHeight: CELL * 3, alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 12 }}>
              <Text style={{ fontSize: 12, fontWeight: "500", color: theme.textPrimary }}>{tab === "emoji" ? "No emoji found" : "No icons found"}</Text>
              <Text style={{ fontSize: 12, color: theme.dark ? "#FFFFFFB3" : "#00000099", textAlign: "center" }}>Try a different search.</Text>
            </View>
          )}
        </ScrollView>
        {current ? (
          <View style={{ borderTopWidth: 0.5, borderTopColor: theme.divider, paddingTop: 8 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Reset icon" onAccessibilityTap={() => choose(null)} onPress={() => choose(null)}>
              {({ pressed }) => (
                <View style={{ height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? theme.rowSelected : theme.urlPill }}>
                  <Text style={{ fontSize: 12, color: theme.textPrimary }}>Reset icon</Text>
                </View>
              )}
            </Pressable>
          </View>
        ) : null}
      </Surface>
    </>
  );
}

function ModeButton({ label, selected, onPress }: { label: string; selected: boolean; onPress(): void }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected }} onAccessibilityTap={onPress} onPress={onPress}>
      {({ pressed }) => (
        <View
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            minWidth: 58,
            height: 24,
            paddingHorizontal: 10,
            borderRadius: 6,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: selected ? theme.panel : pressed || hovered ? theme.rowHover : undefined,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: selected ? "600" : "400", color: theme.textPrimary }}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

function Cell({ item, selected, onPress }: { item: IconOption; selected: boolean; onPress(): void }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.label}
      accessibilityState={{ selected }}
      tooltip={item.label}
      onAccessibilityTap={onPress}
      onPress={onPress}
      style={{ width: CELL, height: CELL, padding: 2 }}
    >
      {({ pressed }) => (
        <View
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            flex: 1,
            borderRadius: 7,
            borderWidth: 1,
            borderColor: selected ? theme.textSecondary : "transparent",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: selected || pressed ? theme.rowSelected : hovered ? theme.rowHover : undefined,
          }}
        >
          {item.value.startsWith(SYMBOL_PREFIX) ? (
            <Symbol name={item.value.slice(SYMBOL_PREFIX.length)} size={17} weight="regular" color={theme.icon} style={{ width: 22, height: 22 }} />
          ) : (
            <Text style={{ fontSize: 20 }}>{item.value}</Text>
          )}
        </View>
      )}
    </Pressable>
  );
}
