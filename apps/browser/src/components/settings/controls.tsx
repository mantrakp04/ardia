import { showMenu, Surface, Symbol, type MenuItem } from "@ardia/shell";
import { useEffect, useRef, type ReactNode, type Ref } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { hex, useTheme, type Theme } from "../../lib/theme";
import { Switch, switchEasing } from "../Switch";
import { useHover } from "../primitives";
import { registerAnchor, useSettingsSearch } from "./searchState";
import { setting } from "./settingsIndex";

function formColors(theme: Theme) {
  return theme.dark
    ? {
        group: "rgba(255,255,255,0.045)",
        groupBorder: "rgba(255,255,255,0.07)",
        separator: "rgba(255,255,255,0.07)",
        control: "rgba(255,255,255,0.1)",
        controlHover: "rgba(255,255,255,0.14)",
        controlPressed: "rgba(255,255,255,0.2)",
        controlBorder: "rgba(255,255,255,0.08)",
        field: "rgba(0,0,0,0.25)",
        fieldBorder: "rgba(255,255,255,0.12)",
        switchOff: "rgba(255,255,255,0.14)",
        accent: "#0A84FF",
        destructive: "#FF453A",
        selected: "rgba(255,255,255,0.1)",
        flash: "rgba(10,132,255,0.22)",
      }
    : {
        group: "rgba(0,0,0,0.028)",
        groupBorder: "rgba(0,0,0,0.07)",
        separator: "rgba(0,0,0,0.07)",
        control: "#FFFFFF",
        controlHover: "#F7F7F7",
        controlPressed: "#EBEBEB",
        controlBorder: "rgba(0,0,0,0.14)",
        field: "#FFFFFF",
        fieldBorder: "rgba(0,0,0,0.14)",
        switchOff: "rgba(0,0,0,0.1)",
        accent: "#007AFF",
        destructive: "#FF3B30",
        selected: "rgba(0,0,0,0.06)",
        flash: "rgba(0,122,255,0.16)",
      };
}

export function useFormColors() {
  return formColors(useTheme());
}

export function Toggle({ value, onChange, disabled, label }: { value: boolean; onChange: (value: boolean) => void; disabled?: boolean; label?: string }) {
  const colors = useFormColors();
  return (
    <Switch
      accessibilityLabel={label}
      value={value}
      onChange={onChange}
      disabled={disabled}
      animateExternalChanges={false}
      look={{ width: 32, height: 18, knob: 15, inset: 1.5, offColor: colors.switchOff, onColor: colors.accent, knobBorder: "rgba(0,0,0,0.12)", duration: 160, easing: switchEasing.cubicOut }}
    />
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
  const colors = useFormColors();
  const on = value || mixed;
  return (
    <Pressable disabled={disabled} onPress={() => onChange(!value)} style={{ flexDirection: "row", alignItems: "center", gap: 7, opacity: disabled ? 0.45 : 1 }}>
      <View
        style={{
          width: 14,
          height: 14,
          borderRadius: 3.5,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: on ? colors.accent : colors.control,
          borderWidth: on ? 0 : StyleSheet.hairlineWidth * 2,
          borderColor: colors.controlBorder,
        }}
      >
        {on && <Symbol name={mixed && !value ? "minus" : "checkmark"} size={9} weight="bold" color="#FFFFFF" style={{ width: 14, height: 14 }} />}
      </View>
      {label ? <Text style={{ fontSize: 13, color: theme.textPrimary }}>{label}</Text> : null}
    </Pressable>
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
  const colors = useFormColors();
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
    <View {...hoverProps} style={{ opacity: disabled ? 0.45 : 1 }}>
      <Pressable disabled={disabled} onPress={open}>
        {({ pressed }) => (
          <View
            style={{
              minWidth,
              height: 22,
              borderRadius: 5.5,
              paddingLeft: 9,
              paddingRight: 4,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              backgroundColor: pressed ? colors.controlPressed : hovered ? colors.controlHover : colors.control,
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderColor: colors.controlBorder,
            }}
          >
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: theme.textPrimary }}>
              {current?.title ?? ""}
            </Text>
            <View style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" }}>
              <Symbol name="chevron.up.chevron.down" size={8} weight="bold" color="#FFFFFF" style={{ width: 16, height: 16 }} />
            </View>
          </View>
        )}
      </Pressable>
    </View>
  );
}

export function Button({
  title,
  onPress,
  kind = "default",
  disabled,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: "default" | "primary" | "destructive" | "plain";
  disabled?: boolean;
  icon?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const colors = useFormColors();
  const { hovered, hoverProps } = useHover();
  const primary = kind === "primary";
  const plain = kind === "plain";
  const textColor = primary ? "#FFFFFF" : kind === "destructive" ? colors.destructive : plain ? colors.accent : theme.textPrimary;
  return (
    <View {...hoverProps} style={[{ opacity: disabled ? 0.45 : 1 }, style]}>
      <Pressable disabled={disabled} onPress={onPress}>
        {({ pressed }) => (
          <View
            style={{
              height: plain ? undefined : 22,
              borderRadius: 5.5,
              paddingHorizontal: plain ? 0 : 10,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              backgroundColor: plain
                ? undefined
                : primary
                  ? pressed
                    ? "#0060D0"
                    : colors.accent
                  : pressed
                    ? colors.controlPressed
                    : hovered
                      ? colors.controlHover
                      : colors.control,
              borderWidth: plain || primary ? 0 : StyleSheet.hairlineWidth * 2,
              borderColor: colors.controlBorder,
            }}
          >
            {icon ? <Symbol name={icon} size={11} color={textColor} style={{ width: 13, height: 13 }} /> : null}
            <Text style={{ fontSize: 13, color: textColor, textDecorationLine: plain && hovered ? "underline" : "none" }}>{title}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const SEARCH_KEYS = [{ key: "Escape" }];
const SEARCH_KEYS_WITH_ARROWS = [{ key: "Escape" }, { key: "Enter" }, { key: "ArrowUp" }, { key: "ArrowDown" }];

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
  const colors = useFormColors();
  return (
    <View
      style={[
        {
          width,
          height: 28,
          borderRadius: 8,
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 8,
          gap: 5,
          backgroundColor: colors.field,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.fieldBorder,
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
        style={{ flex: 1, fontSize: 13, color: theme.textPrimary, paddingVertical: 0 }}
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
  const colors = useFormColors();
  return (
    <View
      style={[
        {
          height: 24,
          borderRadius: 5,
          justifyContent: "center",
          paddingHorizontal: 7,
          backgroundColor: colors.field,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.fieldBorder,
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
        keyDownEvents={onEscape ? [{ key: "Escape" }] : undefined}
        onKeyDown={(e) => e.nativeEvent.key === "Escape" && onEscape?.()}
        style={{ fontSize: 13, color: theme.textPrimary, paddingVertical: 0 }}
      />
    </View>
  );
}

const FLASH_IN_MS = 120;
const FLASH_HOLD_MS = 900;
const FLASH_OUT_MS = 700;

export function Anchor({ id, children, radius = 0, style }: { id?: string; children: ReactNode; radius?: number; style?: StyleProp<ViewStyle> }) {
  const colors = useFormColors();
  const ref = useRef<View>(null);
  const flash = useSettingsSearch((s) => (id && s.flash?.id === id ? s.flash.at : 0));
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => (id && ref.current ? registerAnchor(id, ref.current) : undefined), [id]);
  useEffect(() => {
    if (!flash) return;
    glow.setValue(0);
    const run = Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: FLASH_IN_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.delay(FLASH_HOLD_MS),
      Animated.timing(glow, { toValue: 0, duration: FLASH_OUT_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]);
    run.start();
    return () => run.stop();
  }, [flash]);
  if (!id) return <View style={style}>{children}</View>;
  return (
    <View ref={ref} collapsable={false} style={style}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: colors.flash, opacity: glow }]} />
      {children}
    </View>
  );
}

export function SectionHeader({
  title,
  description,
  action,
  anchor,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  anchor?: string;
}) {
  const theme = useTheme();
  const entry = anchor ? setting(anchor) : undefined;
  const text = title ?? entry?.section ?? "";
  return (
    <Anchor id={anchor} radius={6} style={{ flexDirection: "row", alignItems: "flex-end", marginTop: 22, marginBottom: 8, paddingHorizontal: 2 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: theme.textPrimary }}>{text}</Text>
        {description ? <Text style={{ fontSize: 12, marginTop: 3, color: theme.textSecondary, lineHeight: 16 }}>{description}</Text> : null}
      </View>
      {action}
    </Anchor>
  );
}

export function Group({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const colors = useFormColors();
  const rows = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean);
  return (
    <View
      style={[
        { borderRadius: 10, backgroundColor: colors.group, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.groupBorder, overflow: "hidden" },
        style,
      ]}
    >
      {rows.map((row, i) => (
        <View key={i}>
          {i > 0 && <View style={{ height: StyleSheet.hairlineWidth * 2, marginHorizontal: 12, backgroundColor: colors.separator }} />}
          {row}
        </View>
      ))}
    </View>
  );
}

export function Row({
  title: titleProp,
  description: descriptionProp,
  children,
  icon,
  onPress,
  anchor,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  onPress?: () => void;
  anchor?: string;
}) {
  const theme = useTheme();
  const colors = useFormColors();
  const { hovered, hoverProps } = useHover();
  const entry = anchor ? setting(anchor) : undefined;
  const title = titleProp ?? entry?.title;
  const description = descriptionProp === undefined ? entry?.description : descriptionProp;
  const body = (
    <View
      style={{
        minHeight: 40,
        paddingHorizontal: 12,
        paddingVertical: 9,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        backgroundColor: onPress && hovered ? colors.selected : undefined,
      }}
    >
      {icon}
      <View style={{ flex: 1 }}>
        {typeof title === "string" ? <Text style={{ fontSize: 13, color: theme.textPrimary }}>{title}</Text> : title}
        {description ? (
          typeof description === "string" ? (
            <Text style={{ fontSize: 11.5, marginTop: 2, color: theme.textSecondary, lineHeight: 15 }}>{description}</Text>
          ) : (
            description
          )
        ) : null}
      </View>
      {children}
      {onPress && <Symbol name="chevron.right" size={11} weight="semibold" color={theme.textTertiary} style={{ width: 12, height: 14 }} />}
    </View>
  );
  const row = onPress ? (
    <View {...hoverProps}>
      <Pressable onPress={onPress}>{body}</Pressable>
    </View>
  ) : (
    body
  );
  return anchor ? <Anchor id={anchor}>{row}</Anchor> : row;
}

export function Sheet({ width = 440, onClose, children }: { width?: number; onClose: () => void; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: theme.dark ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.15)" }]} onPress={onClose} />
      <Surface
        fill={hex(theme.panel)}
        cornerRadius={14}
        borderColor={hex(theme.panelBorder)}
        borderWidth={0.5}
        shadowColor="#000000"
        shadowOpacity={theme.panelShadowOpacity}
        shadowRadius={30}
        shadowOffset={[0, 12]}
        style={{ width, maxHeight: "90%", padding: 20 }}
      >
        {children}
      </Surface>
    </View>
  );
}
