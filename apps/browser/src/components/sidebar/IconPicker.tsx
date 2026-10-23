import { Surface, Symbol } from "@ardia/shell";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ICON_CATALOG, ICON_STYLES, iconValue, normalizeIconColor, parseCustomIcon, type IconStyle } from "../../lib/iconCatalog";
import { iconSurfaces } from "../../lib/iconColors";
import { hex, useTheme } from "../../lib/theme";
import { useLive } from "../../live/store";
import { useBrowser } from "../../store/browser";
import { setIcon } from "./actions";
import { setSidebarUi, useSidebarUi } from "./state";
import { CustomIcon } from "../icons/CustomIcon";
import { ICON_COLOR_CUSTOM_HEIGHT, ICON_COLOR_ROW_HEIGHT, IconColorChooser } from "../icons/IconColorChooser";

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

const COLUMNS = 8;
const CELL = 34;
const SCROLLBAR_GUTTER = 16;
const WIDTH = COLUMNS * CELL + 24 + SCROLLBAR_GUTTER;
const TRANSITION_MS = 160;
const STYLE_ROW_HEIGHT = 38;

type IconOption = { value: string; label: string; keywords: string };
type PickerTab = "symbols" | "emoji";

const EMOJI_OPTIONS: IconOption[] = EMOJI.map(([value, words]) => ({ value, label: words[0]!.toUpperCase() + words.slice(1), keywords: words }));

export function IconPicker({ windowId, sidebarWidth, width, height }: { windowId: string; sidebarWidth: number; width: number; height: number }) {
  const picker = useSidebarUi((u) => (u.iconPicker?.windowId === windowId ? u.iconPicker : null));
  return picker ? <PickerPanel key={picker.id} picker={picker} sidebarWidth={sidebarWidth} width={width} height={height} /> : null;
}

type Picker = NonNullable<ReturnType<typeof useSidebarUi.getState>["iconPicker"]>;

function PickerPanel({ picker, sidebarWidth, width, height }: { picker: Picker; sidebarWidth: number; width: number; height: number }) {
  const theme = useTheme();
  const liveIcon = useLive((s) => (picker.kind === "live" ? s.folders[picker.id.split("|")[1] ?? ""]?.icon : null));
  const current = useBrowser((s) => (picker.kind === "tab" ? s.tabs[picker.id]?.customIcon : picker.kind === "live" ? liveIcon : s.groups[picker.id]?.icon) ?? null);
  const currentIcon = current ? parseCustomIcon(current) : null;
  const [tab, setTab] = useState<PickerTab>(current && !currentIcon ? "emoji" : "symbols");
  const [style, setStyle] = useState<IconStyle>(currentIcon?.style ?? "symbols");
  const [query, setQuery] = useState("");
  const [draftColor, setDraftColor] = useState<string | null>(currentIcon?.color ?? null);
  const [colorOptionsOpen, setColorOptionsOpen] = useState(false);
  const [customColorOpen, setCustomColorOpen] = useState(false);
  const [panelHeight, setPanelHeight] = useState(0);
  const colorsVisible = tab === "symbols" && colorOptionsOpen;
  const reduceMotion = useReducedMotion();
  const styleHeight = usePickerHeight(tab === "symbols" ? STYLE_ROW_HEIGHT : 0, reduceMotion);
  const colorTarget = colorsVisible ? ICON_COLOR_ROW_HEIGHT + (customColorOpen ? ICON_COLOR_CUSTOM_HEIGHT : 0) : 0;
  const colorHeight = usePickerHeight(colorTarget, reduceMotion);
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const options = tab === "emoji" ? EMOJI_OPTIONS : ICON_CATALOG.map(({ name, label, keywords }) => ({ value: iconValue(style, name, draftColor), label, keywords: `${name} ${keywords}` }));
    return options.filter(({ value, label, keywords }) => !q || `${label} ${keywords} ${tab === "emoji" ? value : ""}`.toLowerCase().includes(q));
  }, [tab, style, query, draftColor]);
  const changeColor = (value: string | null, settle = true) => {
    const normalized = normalizeIconColor(value);
    if (value !== null && !normalized) return;
    setDraftColor(normalized);
    if (settle && currentIcon) {
      const next = iconValue(currentIcon.style, currentIcon.name, normalized);
      if (next !== current) setIcon(picker, next);
    }
  };
  const close = () => setSidebarUi({ iconPicker: null });
  const choose = (icon: string | null) => {
    setIcon(picker, icon);
    close();
  };
  const availableHeight = height > 0 ? height - 16 : 800;
  const fixedHeight = 24 + 38 + (tab === "symbols" ? STYLE_ROW_HEIGHT : 0) + colorTarget + 40 + (current ? 46.5 : 0);
  const maxGridHeight = Math.max(CELL, availableHeight - fixedHeight);
  const estimatedHeight = fixedHeight + gridHeight(items, maxGridHeight);
  const top = Math.max(8, Math.min((picker.anchor?.y ?? 60) - 8, height > 0 ? height - (panelHeight || estimatedHeight) - 8 : Infinity));
  const anchorLeft = picker.anchor ? Math.min(sidebarWidth + 6, picker.anchor.x + picker.anchor.width + 6) : sidebarWidth + 6;
  const left = Math.max(8, Math.min(anchorLeft, width > 0 ? width - WIDTH - 8 : Infinity));

  return (
    <View pointerEvents="box-none" keyDownEvents={[{ key: "Escape" }]} onKeyDown={(event) => event.nativeEvent.key === "Escape" && close()} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
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
        onLayout={(event) => setPanelHeight(event.nativeEvent.layout.height)}
        style={{ position: "absolute", top, left, width: WIDTH, padding: 12 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: theme.textPrimary }}>Edit icon</Text>
          <View style={{ flexDirection: "row", padding: 2, borderRadius: 8, backgroundColor: theme.urlPill }}>
            <ModeButton label="Icons" selected={tab === "symbols"} onPress={() => setTab("symbols")} />
            <ModeButton label="Emoji" selected={tab === "emoji"} onPress={() => setTab("emoji")} />
          </View>
        </View>
        <Animated.View
          pointerEvents={tab === "symbols" ? "auto" : "none"}
          accessibilityElementsHidden={tab !== "symbols"}
          importantForAccessibility={tab === "symbols" ? "auto" : "no-hide-descendants"}
          style={{ height: styleHeight, opacity: styleHeight.interpolate({ inputRange: [0, STYLE_ROW_HEIGHT], outputRange: [0, 1] }), overflow: "hidden" }}
        >
          <View style={{ flexDirection: "row", padding: 2, borderRadius: 8, backgroundColor: theme.urlPill }}>
            {ICON_STYLES.map(({ id, label }) => (
              <ModeButton key={id} label={label} selected={style === id} disabled={tab !== "symbols"} expand onPress={() => setStyle(id)} />
            ))}
          </View>
        </Animated.View>
        <Animated.View
          pointerEvents={colorsVisible ? "auto" : "none"}
          accessibilityElementsHidden={!colorsVisible}
          importantForAccessibility={colorsVisible ? "auto" : "no-hide-descendants"}
          style={{ height: colorHeight, opacity: colorHeight.interpolate({ inputRange: [0, ICON_COLOR_ROW_HEIGHT], outputRange: [0, 1], extrapolate: "clamp" }), overflow: "hidden" }}
        >
          <IconColorChooser value={draftColor} disabled={!colorsVisible} expanded={customColorOpen} onExpandedChange={setCustomColorOpen} onChange={changeColor} onDismiss={close} />
        </Animated.View>
        <View style={{ height: 30, borderRadius: 8, backgroundColor: theme.urlPill, flexDirection: "row", alignItems: "center", paddingLeft: 9, paddingRight: 2, marginBottom: 10 }}>
          <Symbol name="magnifyingglass" size={12} color={theme.icon} style={{ width: 14, height: 14 }} />
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            accessibilityLabel={tab === "emoji" ? "Search emoji" : "Search icons"}
            placeholder={tab === "emoji" ? "Search emoji" : "Search icons"}
            placeholderTextColor={theme.textHint}
            selectionColor={theme.selection}
            enableFocusRing={false}
            keyDownEvents={[{ key: "Escape" }]}
            onKeyDown={(event) => event.nativeEvent.key === "Escape" && close()}
            onKeyPress={(event) => event.nativeEvent.key === "Escape" && close()}
            onSubmitEditing={() => items[0] && choose(items[0].value)}
            style={{ flex: 1, fontSize: 12, marginLeft: 7, color: theme.textPrimary, paddingVertical: 0 }}
          />
          {tab === "symbols" ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Icon color options" accessibilityState={{ expanded: colorOptionsOpen }} tooltip="Icon color" onPress={() => setColorOptionsOpen(!colorOptionsOpen)} onAccessibilityTap={() => setColorOptionsOpen(!colorOptionsOpen)} style={{ width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: colorOptionsOpen ? theme.rowSelected : undefined }}>
              <Symbol name="paintpalette" size={14} color={theme.icon} style={{ width: 16, height: 16 }} />
            </Pressable>
          ) : null}
        </View>
        <GridTransition maxHeight={maxGridHeight} items={items} tab={tab} iconStyle={style} current={current} reduceMotion={reduceMotion} onChoose={choose} />
        {current ? (
          <View style={{ borderTopWidth: 0.5, borderTopColor: theme.divider, paddingTop: 8, marginTop: 10 }}>
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
    </View>
  );
}

function useReducedMotion() {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    let mounted = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      changed = true;
      if (mounted) setEnabled(value);
    });
    AccessibilityInfo.isReduceMotionEnabled().then(
      (value) => mounted && !changed && setEnabled(value),
      () => {},
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  return enabled;
}

function usePickerHeight(target: number, reduceMotion: boolean) {
  const height = useRef(new Animated.Value(target)).current;
  useEffect(() => {
    if (reduceMotion) {
      height.setValue(target);
      return;
    }
    const animation = Animated.timing(height, { toValue: target, duration: TRANSITION_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [height, target, reduceMotion]);
  return height;
}

type GridSnapshot = { key: string; items: IconOption[]; tab: PickerTab; opacity: Animated.Value };

function gridHeight(items: IconOption[], maxHeight: number) {
  return Math.min(maxHeight, items.length ? Math.min(6, Math.ceil(items.length / COLUMNS)) * CELL : CELL * 3);
}

function GridTransition({ items, tab, iconStyle, current, reduceMotion, maxHeight, onChoose }: {
  maxHeight: number;
  items: IconOption[];
  tab: PickerTab;
  iconStyle: IconStyle;
  current: string | null;
  reduceMotion: boolean;
  onChoose(icon: string): void;
}) {
  const key = `${tab}:${iconStyle}`;
  const [layers, setLayers] = useState<GridSnapshot[]>(() => [{ key, items, tab, opacity: new Animated.Value(1) }]);
  const height = usePickerHeight(gridHeight(items, maxHeight), reduceMotion);
  useLayoutEffect(() => {
    setLayers((existing) => existing.some((layer) => layer.key === key)
      ? existing.map((layer) => layer.key === key ? { ...layer, items, tab } : layer)
      : [...existing, { key, items, tab, opacity: new Animated.Value(0) }]);
  }, [key, items, tab]);
  const removeLayer = useCallback((hiddenKey: string) => setLayers((existing) => existing.filter((layer) => layer.key !== hiddenKey)), []);
  return (
    <Animated.View style={{ height, overflow: "hidden" }}>
      {layers.map((layer) => (
        <GridLayer maxHeight={maxHeight} key={layer.key} layer={layer} active={layer.key === key} current={current} reduceMotion={reduceMotion} onChoose={onChoose} onHidden={removeLayer} />
      ))}
    </Animated.View>
  );
}

function GridLayer({ layer, active, current, reduceMotion, maxHeight, onChoose, onHidden }: {
  maxHeight: number;
  layer: GridSnapshot;
  active: boolean;
  current: string | null;
  reduceMotion: boolean;
  onChoose(icon: string): void;
  onHidden(key: string): void;
}) {
  const theme = useTheme();
  const { key, opacity, items, tab } = layer;
  const currentIcon = parseCustomIcon(current);
  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(active ? 1 : 0);
      if (!active) onHidden(key);
      return;
    }
    let cancelled = false;
    const animation = Animated.timing(opacity, { toValue: active ? 1 : 0, duration: TRANSITION_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start(({ finished }) => {
      if (finished && !active && !cancelled) onHidden(key);
    });
    return () => {
      cancelled = true;
      animation.stop();
    };
  }, [active, reduceMotion, opacity, key, onHidden]);
  return (
    <Animated.View
      pointerEvents={active ? "auto" : "none"}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      style={{ position: "absolute", left: 0, right: 0, top: 0, height: gridHeight(items, maxHeight), opacity }}
    >
      <ScrollView style={{ height: gridHeight(items, maxHeight) }} showsVerticalScrollIndicator>
        {items.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {items.map((item) => {
              const icon = parseCustomIcon(item.value);
              const selected = item.value === current || !!(icon && currentIcon && icon.style === currentIcon.style && icon.name === currentIcon.name);
              return <Cell key={icon?.name ?? item.value} item={item} selected={selected} disabled={!active} onPress={() => onChoose(item.value)} />;
            })}
          </View>
        ) : (
          <View style={{ minHeight: CELL * 3, alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 12 }}>
            <Text style={{ fontSize: 12, fontWeight: "500", color: theme.textPrimary }}>{tab === "emoji" ? "No emoji found" : "No icons found"}</Text>
            <Text style={{ fontSize: 12, color: theme.textHint, textAlign: "center" }}>Try a different search.</Text>
          </View>
        )}
      </ScrollView>
    </Animated.View>
  );
}

function ModeButton({ label, selected, disabled = false, expand = false, onPress }: { label: string; selected: boolean; disabled?: boolean; expand?: boolean; onPress(): void }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected, disabled }} disabled={disabled} focusable={!disabled} onAccessibilityTap={disabled ? undefined : onPress} onPress={disabled ? undefined : onPress} style={expand ? { flex: 1 } : undefined}>
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

function Cell({ item, selected, disabled, onPress }: { item: IconOption; selected: boolean; disabled: boolean; onPress(): void }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      focusable={!disabled}
      tooltip={item.label}
      onAccessibilityTap={disabled ? undefined : onPress}
      onPress={disabled ? undefined : onPress}
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
          {parseCustomIcon(item.value) ? (
            <CustomIcon value={item.value} size={22} glyphSize={17} weight="regular" background={iconSurfaces(theme.panel, selected || pressed ? theme.rowSelected : hovered ? theme.rowHover : null)} />
          ) : (
            <Text style={{ fontSize: 20 }}>{item.value}</Text>
          )}
        </View>
      )}
    </Pressable>
  );
}
