import { showMenu, Symbol, type MenuItem } from "@ardia/shell";
import type { Ref } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "./theme";
import { opacity, radius, space, font as typeScale } from "./tokens";
import { useHover } from "./useHover";

const SEARCH_KEYS = [{ key: "Escape" }];
const SEARCH_KEYS_WITH_ARROWS = [{ key: "Escape" }, { key: "Enter" }, { key: "ArrowUp" }, { key: "ArrowDown" }];
const ESCAPE_KEY = [{ key: "Escape" }];

export function SearchField({
  value,
  onChangeText,
  placeholder,
  autoFocus,
  width,
  style,
  onSubmit,
  onArrow,
  inputRef,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  width?: number;
  style?: StyleProp<ViewStyle>;
  onSubmit?: () => void;
  onArrow?: (step: 1 | -1) => void;
  inputRef?: Ref<TextInput>;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          width,
          height: 28,
          borderRadius: radius.l,
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: space.m,
          gap: 5,
          backgroundColor: theme.field,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: theme.fieldBorder,
        },
        style,
      ]}
    >
      <Symbol name="magnifyingglass" size={12} color={theme.textSecondary} style={{ width: 14, height: 14 }} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textTertiary}
        selectionColor={theme.selection}
        autoFocus={autoFocus}
        enableFocusRing={false}
        onSubmitEditing={onSubmit}
        keyDownEvents={onArrow ? SEARCH_KEYS_WITH_ARROWS : SEARCH_KEYS}
        onKeyDown={(e) => {
          const key = e.nativeEvent.key;
          if (key === "Escape") onChangeText("");
          else if (key === "Enter" && onArrow) onSubmit?.();
          else if (key === "ArrowDown") onArrow?.(1);
          else if (key === "ArrowUp") onArrow?.(-1);
        }}
        style={{ flex: 1, ...typeScale.body, color: theme.textPrimary, paddingVertical: 0 }}
      />
      {value ? (
        <View tooltip="Clear">
          <Pressable onPress={() => onChangeText("")}>
            <Symbol name="xmark.circle.fill" size={12} color={theme.textTertiary} style={{ width: 16, height: 16 }} />
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
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          height: 24,
          borderRadius: radius.field,
          justifyContent: "center",
          paddingHorizontal: 7,
          backgroundColor: theme.field,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: theme.fieldBorder,
        },
        style,
      ]}
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
        onSubmitEditing={onSubmit}
        onBlur={onBlur}
        keyDownEvents={onEscape ? ESCAPE_KEY : undefined}
        onKeyDown={(e) => e.nativeEvent.key === "Escape" && onEscape?.()}
        style={{ ...typeScale.body, color: theme.textPrimary, paddingVertical: 0 }}
      />
    </View>
  );
}

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
              height: 22,
              borderRadius: radius.control,
              paddingLeft: 9,
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
            <View style={{ width: 16, height: 16, borderRadius: radius.s, backgroundColor: theme.formAccent, alignItems: "center", justifyContent: "center" }}>
              <Symbol name="chevron.up.chevron.down" size={8} weight="bold" color={theme.onAccent} style={{ width: 16, height: 16 }} />
            </View>
          </View>
        )}
      </Pressable>
    </View>
  );
}

export function Checkbox({
  value,
  onChange,
  label,
  disabled,
  mixed,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  disabled?: boolean;
  mixed?: boolean;
}) {
  const theme = useTheme();
  const on = value || mixed;
  return (
    <Pressable disabled={disabled} onPress={() => onChange(!value)} style={{ flexDirection: "row", alignItems: "center", gap: 7, opacity: disabled ? opacity.disabled : 1 }}>
      <View
        style={{
          width: 14,
          height: 14,
          borderRadius: 3.5,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: on ? theme.formAccent : theme.control,
          borderWidth: on ? 0 : StyleSheet.hairlineWidth * 2,
          borderColor: theme.controlBorder,
        }}
      >
        {on && <Symbol name={mixed && !value ? "minus" : "checkmark"} size={9} weight="bold" color={theme.onAccent} style={{ width: 14, height: 14 }} />}
      </View>
      {label ? <Text style={{ ...typeScale.body, color: theme.textPrimary }}>{label}</Text> : null}
    </Pressable>
  );
}
