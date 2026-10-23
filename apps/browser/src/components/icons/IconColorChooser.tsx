import { ThemeSwatch } from "@ardia/shaders";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type GestureResponderEvent } from "react-native";
import { normalizeIconColor } from "../../lib/iconCatalog";
import { colorHex, hexColor, hslToRgb, PAD_LIGHTNESS, padColor, padPosition, rgbToHsl } from "../../lib/profileTheme";
import { hex, PROFILE_COLORS, useTheme } from "../../lib/theme";

export const ICON_COLOR_ROW_HEIGHT = 36;
export const ICON_COLOR_CUSTOM_HEIGHT = 112;

const PAD = 96;
const KNOB = 12;
const COLORS = [
  { label: "Red", value: "#E5534B" },
  { label: "Orange", value: "#EE8434" },
  { label: "Green", value: "#3FB06C" },
  { label: "Teal", value: "#35B8A6" },
  { label: "Blue", value: "#4C8DF6" },
  { label: "Purple", value: "#9B6CF0" },
  { label: "Pink", value: "#DB61A2" },
];
const ARROWS = [{ key: "ArrowLeft" }, { key: "ArrowRight" }, { key: "ArrowUp" }, { key: "ArrowDown" }, { key: "Escape" }];
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
type Hsl = [number, number, number];

export function IconColorChooser({ value, disabled, expanded, onExpandedChange, onChange, onDismiss }: {
  value: string | null;
  disabled: boolean;
  expanded: boolean;
  onExpandedChange(expanded: boolean): void;
  onChange(value: string | null): void;
  onDismiss(): void;
}) {
  const theme = useTheme();
  const custom = value !== null && !COLORS.some((color) => color.value === value);
  return (
    <View>
      <View style={{ height: 26, flexDirection: "row", alignItems: "center", gap: 3 }}>
        <ColorButton label="Theme color" title="Theme" selected={value === null} disabled={disabled} onPress={() => onChange(null)} />
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-evenly" }}>
          {COLORS.map((color) => (
            <Pressable
              key={color.value}
              accessibilityRole="button"
              accessibilityLabel={`${color.label} icon color`}
              accessibilityState={{ selected: value === color.value, disabled }}
              disabled={disabled}
              focusable={!disabled}
              tooltip={color.label}
              onPress={disabled ? undefined : () => onChange(color.value)}
              onAccessibilityTap={disabled ? undefined : () => onChange(color.value)}
            >
              {({ pressed }) => (
                <View style={{ width: 20, height: 24, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.65 : 1 }}>
                  <View style={{ width: 19, height: 19, borderRadius: 10, borderWidth: 1, borderColor: value === color.value ? theme.textPrimary : "transparent", alignItems: "center", justifyContent: "center" }}>
                    <View style={{ width: 13, height: 13, borderRadius: 7, backgroundColor: color.value }} />
                  </View>
                </View>
              )}
            </Pressable>
          ))}
        </View>
        <ColorButton label="Custom icon color" title="Custom" selected={custom} disabled={disabled} expanded={expanded} onPress={() => onExpandedChange(!expanded)} />
      </View>
      <View pointerEvents={expanded && !disabled ? "auto" : "none"} accessibilityElementsHidden={!expanded || disabled} importantForAccessibility={expanded && !disabled ? "auto" : "no-hide-descendants"} style={{ height: ICON_COLOR_CUSTOM_HEIGHT, marginTop: 10 }}>
        <ColorEditor value={value} disabled={disabled || !expanded} onChange={onChange} onDismiss={onDismiss} />
      </View>
    </View>
  );
}

function ColorButton({ label, title, selected, disabled, expanded, onPress }: {
  label: string;
  title: string;
  selected: boolean;
  disabled: boolean;
  expanded?: boolean;
  onPress(): void;
}) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled, expanded }} disabled={disabled} focusable={!disabled} onPress={disabled ? undefined : onPress} onAccessibilityTap={disabled ? undefined : onPress}>
      {({ pressed }) => (
        <View style={{ height: 24, paddingHorizontal: 5, borderRadius: 6, backgroundColor: selected || pressed ? theme.rowSelected : theme.urlPill }}>
          <Text style={{ fontSize: 10, lineHeight: 24, color: theme.textPrimary, fontWeight: selected ? "600" : "400" }}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

function ColorEditor({ value, disabled, onChange, onDismiss }: { value: string | null; disabled: boolean; onChange(value: string): void; onDismiss(): void }) {
  const theme = useTheme();
  const primary = theme.custom && theme.powerUpPalette?.length
    ? theme.powerUpPalette[0]
    : theme.profileColor === "incognito" ? theme.icon : PROFILE_COLORS[theme.profileColor].swatch;
  const fallback = normalizeIconColor(hex(primary ?? theme.icon).slice(0, 7)) ?? "#4C8DF6";
  const initial = hexColor(value ?? fallback);
  const [hsl, setHsl] = useState<Hsl>(() => rgbToHsl(initial.r, initial.g, initial.b));
  const [draft, setDraft] = useState(value ?? fallback);
  const latest = useRef(hsl);
  const emitted = useRef<string | null>(null);
  const sliderWidth = useRef(1);
  latest.current = hsl;
  useEffect(() => {
    setDraft(value ?? fallback);
    if (value !== null && value === emitted.current) return;
    const color = hexColor(value ?? fallback);
    const next = rgbToHsl(color.r, color.g, color.b);
    latest.current = next;
    setHsl(next);
  }, [value, fallback]);
  const change = (next: Hsl) => {
    if (disabled) return;
    latest.current = next;
    setHsl(next);
    const [r, g, b] = hslToRgb(...next);
    const color = colorHex({ r, g, b, a: 1 });
    emitted.current = color;
    setDraft(color);
    onChange(color);
  };
  const wheel = (event: GestureResponderEvent) => {
    const x = event.nativeEvent.locationX / PAD - 0.5;
    const y = event.nativeEvent.locationY / PAD - 0.5;
    const radius = Math.hypot(x, y);
    const scale = radius > 0.5 ? 0.5 / radius : 1;
    const color = padColor(0.5 + x * scale, 0.5 + y * scale);
    const [h, s] = rgbToHsl(color.r, color.g, color.b);
    change([h, s, latest.current[2]]);
  };
  const lightness = (event: GestureResponderEvent) => change([latest.current[0], latest.current[1], clamp01(event.nativeEvent.locationX / sliderWidth.current)]);
  const shiftHue = (delta: number) => change([(latest.current[0] + delta + 1) % 1, latest.current[1], latest.current[2]]);
  const shiftLightness = (delta: number) => change([latest.current[0], latest.current[1], clamp01(latest.current[2] + delta)]);
  const [r, g, b] = hslToRgb(...hsl);
  const color = { r, g, b, a: 1 };
  const [pr, pg, pb] = hslToRgb(hsl[0], hsl[1], PAD_LIGHTNESS);
  const position = padPosition({ r: pr, g: pg, b: pb, a: 1 });
  const invalid = normalizeIconColor(draft) === null;
  const applyHex = (text: string) => {
    if (disabled) return;
    setDraft(text);
    const normalized = normalizeIconColor(text);
    if (!normalized) return;
    const next = hexColor(normalized);
    emitted.current = null;
    const nextHsl = rgbToHsl(next.r, next.g, next.b);
    latest.current = nextHsl;
    setHsl(nextHsl);
    onChange(normalized);
  };
  return (
    <View style={{ height: PAD, flexDirection: "row", gap: 14 }}>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel="Icon color wheel"
        accessibilityValue={{ text: colorHex(color) }}
        accessibilityState={{ disabled }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={disabled ? undefined : (event) => shiftHue(event.nativeEvent.actionName === "increment" ? 1 / 36 : -1 / 36)}
        focusable={!disabled}
        keyDownEvents={ARROWS}
        onKeyDown={disabled ? undefined : (event) => {
          const key = event.nativeEvent.key;
          if (key === "Escape") onDismiss();
          if (key === "ArrowLeft" || key === "ArrowRight") shiftHue(key === "ArrowRight" ? 1 / 36 : -1 / 36);
          if (key === "ArrowUp" || key === "ArrowDown") change([latest.current[0], clamp01(latest.current[1] + (key === "ArrowUp" ? 0.05 : -0.05)), latest.current[2]]);
        }}
        acceptsFirstMouse={!disabled}
        mouseDownCanMoveWindow={false}
        onStartShouldSetResponder={() => !disabled}
        onResponderGrant={wheel}
        onResponderMove={wheel}
        onResponderRelease={wheel}
        style={{ width: PAD, height: PAD }}
      >
        <View pointerEvents="none" style={{ width: PAD, height: PAD, borderRadius: PAD / 2, overflow: "hidden" }}>
          <ThemeSwatch colors={[]} padLightness={hsl[2]} style={StyleSheet.absoluteFill} />
        </View>
        <View pointerEvents="none" style={{ position: "absolute", left: position.x * PAD - KNOB / 2, top: position.y * PAD - KNOB / 2, width: KNOB, height: KNOB, borderRadius: KNOB / 2, borderWidth: 2, borderColor: "#FFFFFF", backgroundColor: colorHex(color) }}>
          <View style={{ position: "absolute", left: -3, top: -3, right: -3, bottom: -3, borderRadius: KNOB / 2 + 2, borderWidth: 1, borderColor: "#00000066" }} />
        </View>
      </View>
      <View style={{ flex: 1, justifyContent: "center", gap: 8 }}>
        <View>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 11, color: theme.textPrimary }}>Lightness</Text>
            <Text style={{ fontSize: 11, color: theme.textPrimary }}>{Math.round(hsl[2] * 100)}%</Text>
          </View>
          <View
            accessibilityRole="adjustable"
            accessibilityLabel="Icon color lightness"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(hsl[2] * 100) }}
            accessibilityState={{ disabled }}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
            onAccessibilityAction={disabled ? undefined : (event) => shiftLightness(event.nativeEvent.actionName === "increment" ? 0.05 : -0.05)}
            focusable={!disabled}
            keyDownEvents={ARROWS}
            onKeyDown={disabled ? undefined : (event) => {
              if (event.nativeEvent.key === "Escape") onDismiss();
              if (event.nativeEvent.key === "ArrowLeft" || event.nativeEvent.key === "ArrowDown") shiftLightness(-0.05);
              if (event.nativeEvent.key === "ArrowRight" || event.nativeEvent.key === "ArrowUp") shiftLightness(0.05);
            }}
            onLayout={(event) => (sliderWidth.current = Math.max(1, event.nativeEvent.layout.width))}
            acceptsFirstMouse={!disabled}
            mouseDownCanMoveWindow={false}
            onStartShouldSetResponder={() => !disabled}
            onResponderGrant={lightness}
            onResponderMove={lightness}
            onResponderRelease={lightness}
            style={{ height: 24, justifyContent: "center" }}
          >
            <View pointerEvents="none" style={{ height: 6, borderRadius: 3, overflow: "hidden", flexDirection: "row" }}>
              {Array.from({ length: 24 }, (_, index) => {
                const [sr, sg, sb] = hslToRgb(hsl[0], hsl[1], index / 23);
                return <View key={index} style={{ flex: 1, backgroundColor: colorHex({ r: sr, g: sg, b: sb, a: 1 }) }} />;
              })}
            </View>
            <View pointerEvents="none" style={{ position: "absolute", left: `${hsl[2] * 100}%`, marginLeft: -6, width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: "#00000066", backgroundColor: "#FFFFFF" }} />
          </View>
        </View>
        <View style={{ height: 28, flexDirection: "row", alignItems: "center", gap: 7 }}>
          <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: colorHex(color), borderWidth: 0.5, borderColor: theme.panelBorder }} />
          <TextInput
            accessibilityLabel="Hex icon color"
            value={draft}
            editable={!disabled}
            focusable={!disabled}
            onChangeText={applyHex}
            onSubmitEditing={() => applyHex(draft)}
            onKeyPress={disabled ? undefined : (event) => {
              if (event.nativeEvent.key === "Escape") onDismiss();
            }}
            keyDownEvents={[{ key: "Escape" }]}
            onKeyDown={disabled ? undefined : (event) => {
              if (event.nativeEvent.key === "Escape") onDismiss();
            }}
            maxLength={7}
            autoCorrect={false}
            autoCapitalize="characters"
            selectTextOnFocus
            selectionColor={theme.selection}
            style={{ flex: 1, height: 28, borderRadius: 6, borderWidth: 1, borderColor: invalid ? "#E5534B" : theme.panelBorder, backgroundColor: theme.urlPill, color: theme.textPrimary, fontSize: 12, lineHeight: 14, textAlign: "center", paddingHorizontal: 7, paddingVertical: 6 }}
          />
        </View>
      </View>
    </View>
  );
}
