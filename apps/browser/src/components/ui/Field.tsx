import { useInterfaceMetrics, scaleInterfaceStyle } from "./interfaceSize";
import { scaleMetrics } from "../../lib/interfaceMetrics";
import { Symbol as Symbol, RawText as Text, TextInput as TextInput } from "./ScaledNative";
import { useMemo } from "react";
import { OutsidePressArea, showMenu, type MenuItem } from "@ardia/shell";
import { useEffect, useRef, type Ref } from "react";
import { Animated, Pressable, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import { curve, duration } from "./motion";
import { useTheme } from "./theme";
import { capsule, opacity, proseLineHeight, radius, space, font as typeScale } from "./tokens";
import { useHover } from "./useHover";

const SEARCH_KEYS = [{ key: "Escape" }];
const SEARCH_KEYS_WITH_ENTER = [{ key: "Escape" }, { key: "Enter" }, { key: "Enter", shiftKey: true }];
const SEARCH_KEYS_WITH_ARROWS = [{ key: "Escape" }, { key: "Enter" }, { key: "Enter", shiftKey: true }, { key: "ArrowUp" }, { key: "ArrowDown" }];
const BARE_SEARCH = { glyph: 13, glyphBox: 16 } as const;
const ESCAPE_KEY = [{ key: "Escape" }];

export function SearchField({
  value,
  onChangeText,
  placeholder,
  autoFocus,
  width,
  style,
  look = "field",
  onSubmit,
  onEscape,
  onArrow,
  onBlur,
  inputRef,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  width?: DimensionValue;
  style?: StyleProp<ViewStyle>;
  look?: "field" | "bare";
  onSubmit?: (shift: boolean) => void;
  onEscape?: () => void;
  onArrow?: (step: 1 | -1) => void;
  onBlur?: () => void;
  inputRef?: Ref<TextInput>;
}) {
  const interfaceScale = useInterfaceMetrics().factor;
  const { space, radius, BARE_SEARCH } = useMemo(() => ({ space: scaleMetrics(BASE_INTERFACE_METRICS.space, interfaceScale), radius: scaleMetrics(BASE_INTERFACE_METRICS.radius, interfaceScale), BARE_SEARCH: scaleMetrics(BASE_INTERFACE_METRICS.BARE_SEARCH, interfaceScale) }), [interfaceScale]);
  const theme = useTheme();
  const bare = look === "bare";
  return (
    <View
      style={[
        bare
          ? { width, flexDirection: "row", alignItems: "center", gap: space.s }
          : {
              width,
              height: 28 * interfaceScale,
              borderRadius: radius.tile,
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: space.m,
              gap: space.xs,
              backgroundColor: theme.field,
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderColor: theme.fieldBorder,
            },
        style,
      ]}
    >
      {bare ? (
        <Symbol name="magnifyingglass" size={BASE_INTERFACE_METRICS.BARE_SEARCH.glyph} color={theme.textSecondary} style={{ width: BARE_SEARCH.glyphBox, height: BARE_SEARCH.glyphBox }} />
      ) : (
        <Symbol name="magnifyingglass" size={12} color={theme.textSecondary} style={{ width: 14 * interfaceScale, height: 14 * interfaceScale }} />
      )}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={bare ? theme.placeholder : theme.textTertiary}
        selectionColor={theme.selection}
        autoFocus={autoFocus}
        enableFocusRing={false}
        onBlur={onBlur}
        keyDownEvents={onArrow ? SEARCH_KEYS_WITH_ARROWS : onSubmit ? SEARCH_KEYS_WITH_ENTER : SEARCH_KEYS}
        onKeyDown={(e) => {
          const { key, shiftKey } = e.nativeEvent;
          if (key === "Escape") (onEscape ?? (() => onChangeText("")))();
          else if (key === "Enter") onSubmit?.(!!shiftKey);
          else if (key === "ArrowDown") onArrow?.(1);
          else if (key === "ArrowUp") onArrow?.(-1);
        }}
        style={{ flex: 1, ...(bare ? typeScale.title : typeScale.body), color: theme.textPrimary, paddingVertical: 0 }}
      />
      {value && !bare ? (
        <View tooltip="Clear">
          <Pressable onPress={() => onChangeText("")}>
            <Symbol name="xmark.circle.fill" size={12} color={theme.textTertiary} style={{ width: 16 * interfaceScale, height: 16 * interfaceScale }} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function TextField({
  value,
  onChangeText,
  placeholder,
  autoFocus,
  secure,
  onSubmit,
  onEscape,
  onBlur,
  selectOnFocus,
  multiline,
  mono,
  invalid,
  width,
  style,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  secure?: boolean;
  onSubmit?: () => void;
  onEscape?: () => void;
  onBlur?: () => void;
  selectOnFocus?: boolean;
  multiline?: boolean;
  mono?: boolean;
  invalid?: boolean;
  width?: DimensionValue;
  style?: StyleProp<ViewStyle>;
}) {
  const interfaceScale = useInterfaceMetrics().factor;
  const { MULTILINE_HEIGHT, radius, space, MULTILINE_TEXT, MONO } = useMemo(() => ({ MULTILINE_HEIGHT: scaleMetrics(BASE_INTERFACE_METRICS.MULTILINE_HEIGHT, interfaceScale), radius: scaleMetrics(BASE_INTERFACE_METRICS.radius, interfaceScale), space: scaleMetrics(BASE_INTERFACE_METRICS.space, interfaceScale), MULTILINE_TEXT: scaleInterfaceStyle(BASE_INTERFACE_METRICS.MULTILINE_TEXT, interfaceScale), MONO: scaleMetrics(BASE_INTERFACE_METRICS.MONO, interfaceScale) }), [interfaceScale]);
  const theme = useTheme();
  return (
    <OutsidePressArea style={[{ width }, style]}>
      <View
        style={{
          height: multiline ? MULTILINE_HEIGHT : 24,
          borderRadius: radius.control,
          justifyContent: multiline ? "flex-start" : "center",
          paddingHorizontal: space.m,
          paddingVertical: multiline ? space.m : 0,
          backgroundColor: theme.field,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: invalid ? theme.destructive : theme.fieldBorder,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.textTertiary}
          selectionColor={theme.selection}
          autoFocus={autoFocus}
          secureTextEntry={secure}
          enableFocusRing={false}
          selectTextOnFocus={selectOnFocus}
          multiline={multiline}
          autoCorrect={mono ? false : undefined}
          spellCheck={mono ? false : undefined}
          onSubmitEditing={onSubmit}
          onBlur={onBlur}
          keyDownEvents={onEscape ? ESCAPE_KEY : undefined}
          onKeyDown={(e) => e.nativeEvent.key === "Escape" && onEscape?.()}
          style={[{ ...typeScale.body, color: theme.textPrimary, paddingVertical: 0 }, multiline && MULTILINE_TEXT, mono && MONO]}
        />
      </View>
    </OutsidePressArea>
  );
}

const MULTILINE_HEIGHT = 96;
const MULTILINE_TEXT = { flex: 1, lineHeight: proseLineHeight.body } as const;
const MONO = { fontFamily: "Menlo" } as const;

export type Option<T extends string> = { value: T; title: string; separatorBefore?: boolean };

export function PopUp<T extends string>({
  value,
  options,
  onChange,
  minWidth = 120,
  disabled,
}: {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  minWidth?: number;
  disabled?: boolean;
}) {
  const interfaceScale = useInterfaceMetrics().factor;
  const { radius, space } = useMemo(() => ({ radius: scaleMetrics(BASE_INTERFACE_METRICS.radius, interfaceScale), space: scaleMetrics(BASE_INTERFACE_METRICS.space, interfaceScale) }), [interfaceScale]);
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const current = options.find((o) => o.value === value);
  const open = async () => {
    const items: MenuItem[] = options.flatMap((o) => [
      ...(o.separatorBefore ? [{ separator: true as const }] : []),
      { id: o.value, title: o.title, checked: o.value === value },
    ]);
    const choice = await showMenu(items);
    if (choice !== null && choice !== value) onChange(choice as T);
  };
  return (
    <View {...hoverProps} style={{ opacity: disabled ? opacity.disabled : 1 }}>
      <Pressable disabled={disabled} onPress={open}>
        {({ pressed }) => (
          <View
            style={{
              minWidth,
              height: 22 * interfaceScale,
              borderRadius: radius.control,
              paddingLeft: space.m,
              paddingRight: space.xs,
              flexDirection: "row",
              alignItems: "center",
              gap: space.s,
              backgroundColor: pressed ? theme.controlPressed : hovered ? theme.controlHover : theme.control,
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderColor: theme.controlBorder,
            }}
          >
            <Text numberOfLines={1} style={{ flex: 1, ...typeScale.body, color: theme.textPrimary }}>
              {current?.title ?? ""}
            </Text>
            <View style={{ width: 16 * interfaceScale, height: 16 * interfaceScale, borderRadius: radius.control, backgroundColor: theme.formAccent, alignItems: "center", justifyContent: "center" }}>
              <Symbol name="chevron.up.chevron.down" size={8} weight="bold" color={theme.onAccent} style={{ width: 16 * interfaceScale, height: 16 * interfaceScale }} />
            </View>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const CHECK_RING = { s: { box: 14, glyph: 8 }, m: { box: 18, glyph: 10 } } as const;
const CHECK_RING_BORDER = 1.5;

export function Checkbox({
  value,
  onChange,
  label,
  disabled,
  mixed,
  look = "form",
  size = "m",
}: {
  value: boolean;
  onChange?: (value: boolean) => void;
  label?: string;
  disabled?: boolean;
  mixed?: boolean;
  look?: "form" | "ring";
  size?: keyof typeof CHECK_RING;
}) {
  const interfaceScale = useInterfaceMetrics().factor;
  const { space, radius } = useMemo(() => ({ space: scaleMetrics(BASE_INTERFACE_METRICS.space, interfaceScale), radius: scaleMetrics(BASE_INTERFACE_METRICS.radius, interfaceScale) }), [interfaceScale]);
  const theme = useTheme();
  const on = value || mixed;
  if (look === "ring" && !onChange) return <RingCheck on={!!on} size={size} />;
  if (look === "ring")
    return (
      <Pressable disabled={disabled} onPress={() => onChange?.(!value)} accessibilityRole="checkbox" accessibilityState={{ checked: value, disabled }} style={{ opacity: disabled ? opacity.disabled : 1 }}>
        <RingCheck on={!!on} size={size} />
      </Pressable>
    );
  return (
    <Pressable disabled={disabled || !onChange} onPress={() => onChange?.(!value)} style={{ flexDirection: "row", alignItems: "center", gap: space.m, opacity: disabled ? opacity.disabled : 1 }}>
      <View
        style={{
          width: 14 * interfaceScale,
          height: 14 * interfaceScale,
          borderRadius: radius.control,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: on ? theme.formAccent : theme.control,
          borderWidth: on ? 0 : StyleSheet.hairlineWidth * 2,
          borderColor: theme.controlBorder,
        }}
      >
        {on && <Symbol name={mixed && !value ? "minus" : "checkmark"} size={9} weight="bold" color={theme.onAccent} style={{ width: 14 * interfaceScale, height: 14 * interfaceScale }} />}
      </View>
      {label ? <Text style={{ ...typeScale.body, color: theme.textPrimary }}>{label}</Text> : null}
    </Pressable>
  );
}

function RingCheck({ on, size = "m" }: { on: boolean; size?: keyof typeof CHECK_RING }) {
  const interfaceScale = useInterfaceMetrics().factor;
  const { CHECK_RING, CHECK_RING_BORDER } = useMemo(() => ({ CHECK_RING: scaleMetrics(BASE_INTERFACE_METRICS.CHECK_RING, interfaceScale), CHECK_RING_BORDER: scaleMetrics(BASE_INTERFACE_METRICS.CHECK_RING_BORDER, interfaceScale) }), [interfaceScale]);
  const theme = useTheme();
  const { box, glyph } = CHECK_RING[size];
  const t = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: on ? 1 : 0, duration: duration.base, easing: curve.enter, useNativeDriver: true }).start();
  }, [on, interfaceScale]);
  return (
    <View
      style={{
        width: box,
        height: box,
        borderRadius: capsule(box),
        backgroundColor: theme.ringRadioFill,
        borderWidth: CHECK_RING_BORDER,
        borderColor: theme.ringRadioBorder,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <Animated.View
        style={{
          position: "absolute",
          left: -CHECK_RING_BORDER,
          top: -CHECK_RING_BORDER,
          width: box,
          height: box,
          borderRadius: capsule(box),
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.ringRadioOn,
          opacity: t,
          transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
        }}
      >
        <Symbol name="checkmark" size={glyph} weight="bold" color={theme.onPrimary} style={{ width: box, height: box }} />
      </Animated.View>
    </View>
  );
}

const BASE_INTERFACE_METRICS = { space, radius, BARE_SEARCH, MULTILINE_HEIGHT, MULTILINE_TEXT, MONO, CHECK_RING, CHECK_RING_BORDER };
