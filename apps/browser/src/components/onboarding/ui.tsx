import { Symbol } from "@ardia/shell";
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../../lib/theme";
import { useHover } from "../primitives";
import { questionsFor, STEPS, useOnboarding, type OnboardingStep } from "./state";

function onboardingColors(dark: boolean) {
  return dark
    ? {
        background: "#000000",
        overlay: "rgba(0,0,0,0.6)",
        card: "#161616",
        cardBorder: "rgba(254,255,255,0.3)",
        title: "#FEFFFF",
        subtitle: "rgba(254,255,255,0.6)",
        body: "rgba(255,255,255,0.55)",
        footnote: "rgba(255,255,255,0.5)",
        steps: "rgba(255,255,255,0.3)",
        row: "rgba(255,255,255,0.08)",
        rowBorder: "rgba(255,255,255,0.16)",
        rowSubtitle: "rgba(255,255,255,0.6)",
        primary: "rgba(255,255,255,0.85)",
        primaryHover: "rgba(255,255,255,0.9)",
        primaryText: "#000000",
        button: "rgba(255,255,255,0.08)",
        buttonHover: "rgba(255,255,255,0.1)",
        buttonText: "#FFFFFF",
        outlinedHover: "rgba(255,255,255,0.03)",
        noThanksBorder: "rgba(254,255,255,0.2)",
        noThanksText: "rgba(254,255,255,0.5)",
        iconContainer: "rgba(255,255,255,0.15)",
        separator: "rgba(254,255,255,0.1)",
        preview: "rgba(255,255,255,0.04)",
        previewBorder: "rgba(255,255,255,0.1)",
        progressTrack: "rgba(255,255,255,0.12)",
        progressFill: "#FDD023",
        checkbox: "rgba(255,255,255,0.1)",
        checkboxBorder: "rgba(255,255,255,0.25)",
        checkboxOn: "#FEFFFF",
        checkmark: "#000000",
      }
    : {
        background: "#FEFFFF",
        overlay: "rgba(254,255,255,0.6)",
        card: "#FFFFFF",
        cardBorder: "rgba(0,0,0,0.08)",
        title: "#000000",
        subtitle: "rgba(0,0,0,0.53)",
        body: "rgba(0,0,0,0.55)",
        footnote: "rgba(0,0,0,0.5)",
        steps: "rgba(0,0,0,0.3)",
        row: "rgba(0,0,0,0.015)",
        rowBorder: "rgba(0,0,0,0.08)",
        rowSubtitle: "rgba(0,0,0,0.6)",
        primary: "rgba(0,0,0,0.85)",
        primaryHover: "rgba(0,0,0,0.9)",
        primaryText: "#FEFFFF",
        button: "rgba(0,0,0,0.08)",
        buttonHover: "rgba(0,0,0,0.1)",
        buttonText: "#000000",
        outlinedHover: "rgba(0,0,0,0.03)",
        noThanksBorder: "rgba(0,0,0,0.1)",
        noThanksText: "rgba(0,0,0,0.5)",
        iconContainer: "rgba(0,0,0,0.03)",
        separator: "rgba(0,0,0,0.1)",
        preview: "rgba(0,0,0,0.025)",
        previewBorder: "rgba(0,0,0,0.07)",
        progressTrack: "rgba(0,0,0,0.08)",
        progressFill: "#FDD023",
        checkbox: "#FFFFFF",
        checkboxBorder: "rgba(0,0,0,0.2)",
        checkboxOn: "#000000",
        checkmark: "#FFFFFF",
      };
}

export const useOnboardingColors = () => onboardingColors(useTheme().dark);

export function Reveal({ delay = 0, children, style }: { delay?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 420, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View style={[style, { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

export function StepProgress() {
  const colors = useOnboardingColors();
  const step = useOnboarding((s) => s.step);
  const sub = useOnboarding((s) => s.sub);
  useOnboarding((s) => s.draft);
  const steps: OnboardingStep[] = STEPS.filter((s) => s !== "intro");
  const index = steps.indexOf(step);
  const count = questionsFor(step).length;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", gap: 4 }}>
        {steps.map((s, i) => (
          <View key={s} style={{ width: 22, height: 3, borderRadius: 1.5, backgroundColor: i <= index ? colors.progressFill : colors.progressTrack }} />
        ))}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, height: 14 }}>
        <Text style={{ fontSize: 11, fontWeight: "500", letterSpacing: 0.2, color: colors.steps }}>{`STEP ${index + 1} OF ${steps.length}`}</Text>
        {count > 1 ? (
          <View style={{ flexDirection: "row", gap: 4 }} accessibilityLabel={`Question ${sub + 1} of ${count}`}>
            {Array.from({ length: count }, (_, i) => (
              <View key={i} style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: i <= sub ? colors.title : colors.progressTrack, opacity: i === sub ? 1 : i < sub ? 0.45 : 1 }} />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function StepTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  const colors = useOnboardingColors();
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 26, lineHeight: 31, fontWeight: "300", letterSpacing: -0.4, color: colors.title }}>{title}</Text>
      {subtitle ? <Text style={{ fontSize: 13.5, lineHeight: 19, color: colors.subtitle }}>{subtitle}</Text> : null}
    </View>
  );
}

export function PrimaryButton({ title, onPress, disabled, icon }: { title: string; onPress: () => void; disabled?: boolean; icon?: string }) {
  const colors = useOnboardingColors();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} style={{ opacity: disabled ? 0.4 : 1 }}>
      <Pressable disabled={disabled} onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
        {({ pressed }) => (
          <View
            mouseDownCanMoveWindow={false}
            style={{
              height: 36,
              borderRadius: 18,
              paddingHorizontal: 20,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              backgroundColor: hovered && !disabled ? colors.primaryHover : colors.primary,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primaryText }}>{title}</Text>
            {icon ? <Symbol name={icon} size={11} weight="semibold" color={colors.primaryText} style={{ width: 12, height: 12 }} /> : null}
          </View>
        )}
      </Pressable>
    </View>
  );
}

export function SecondaryButton({ title, onPress, filled }: { title: string; onPress: () => void; filled?: boolean }) {
  const colors = useOnboardingColors();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
        {({ pressed }) => (
          <View
            mouseDownCanMoveWindow={false}
            style={{
              height: 36,
              borderRadius: 18,
              paddingHorizontal: 18,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: filled ? (hovered ? colors.buttonHover : colors.button) : hovered ? colors.outlinedHover : "transparent",
              borderWidth: filled ? 0 : 1,
              borderColor: colors.noThanksBorder,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: "500", color: filled ? colors.buttonText : colors.noThanksText }}>{title}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

export function CheckMark({ on, size = 18 }: { on: boolean; size?: number }) {
  const colors = useOnboardingColors();
  const t = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: on ? 1 : 0, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [on]);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.checkbox,
        borderWidth: 1.5,
        borderColor: colors.checkboxBorder,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <Animated.View
        style={{
          position: "absolute",
          left: -1.5,
          top: -1.5,
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.checkboxOn,
          opacity: t,
          transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
        }}
      >
        <Symbol name="checkmark" size={size * 0.5} weight="bold" color={colors.checkmark} style={{ width: size, height: size }} />
      </Animated.View>
    </View>
  );
}

export function Radio({ on }: { on: boolean }) {
  const colors = useOnboardingColors();
  return (
    <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: on ? 5 : 1.5, borderColor: on ? colors.checkboxOn : colors.checkboxBorder, backgroundColor: colors.checkbox }} />
  );
}

export function BackButton({ onPress }: { onPress: () => void }) {
  const colors = useOnboardingColors();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Back">
        {({ pressed }) => (
          <View
            mouseDownCanMoveWindow={false}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: hovered ? colors.outlinedHover : "transparent",
              borderWidth: 1,
              borderColor: colors.noThanksBorder,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            }}
          >
            <Symbol name="chevron.left" size={12} weight="semibold" color={colors.noThanksText} style={{ width: 14, height: 14 }} />
          </View>
        )}
      </Pressable>
    </View>
  );
}

export function Tag({ title }: { title: string }) {
  const colors = useOnboardingColors();
  return (
    <View style={{ height: 20, paddingHorizontal: 8, borderRadius: 10, justifyContent: "center", backgroundColor: colors.button }}>
      <Text style={{ fontSize: 11, fontWeight: "600", color: colors.title }}>{title}</Text>
    </View>
  );
}

export function SectionLabel({ title, accessory }: { title: string; accessory?: ReactNode }) {
  const colors = useOnboardingColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 18 }}>
      <Text style={{ fontSize: 12, fontWeight: "500", color: colors.subtitle }}>{title}</Text>
      {accessory}
    </View>
  );
}

function RowFrame({ children, hovered, disabled, compact }: { children: ReactNode; hovered: boolean; disabled?: boolean; compact?: boolean }) {
  const colors = useOnboardingColors();
  return (
    <View
      mouseDownCanMoveWindow={false}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: compact ? 10 : 12,
        minHeight: compact ? 36 : undefined,
        paddingVertical: compact ? 6 : 9,
        paddingHorizontal: 12,
        borderRadius: compact ? 10 : 12,
        backgroundColor: hovered && !disabled ? colors.button : colors.row,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: colors.rowBorder,
      }}
    >
      {children}
    </View>
  );
}

export function CheckRow({
  title,
  subtitle,
  value,
  onChange,
  disabled,
  icon,
  compact,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  icon?: string;
  compact?: boolean;
}) {
  const colors = useOnboardingColors();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} style={{ opacity: disabled ? 0.5 : 1 }}>
      <Pressable disabled={disabled} onPress={() => onChange(!value)} accessibilityRole="checkbox" accessibilityState={{ checked: value, disabled }} accessibilityLabel={title}>
        <RowFrame hovered={hovered} disabled={disabled} compact={compact}>
          {icon ? (
            <View mouseDownCanMoveWindow={false} style={{ width: 28, height: 28, borderRadius: 7, backgroundColor: colors.iconContainer, alignItems: "center", justifyContent: "center" }}>
              <Symbol name={icon} size={13} color={colors.title} style={{ width: 28, height: 28 }} />
            </View>
          ) : null}
          <View mouseDownCanMoveWindow={false} style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: compact ? 12.5 : 13, fontWeight: "500", color: colors.title }}>{title}</Text>
            {subtitle ? (
              <Text numberOfLines={2} style={{ fontSize: compact ? 11 : 12, color: colors.rowSubtitle }}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          <CheckMark on={value} size={compact ? 16 : 18} />
        </RowFrame>
      </Pressable>
    </View>
  );
}

export function ChoiceRow({
  title,
  subtitle,
  selected,
  onPress,
  onHover,
}: {
  title: string;
  subtitle: string;
  selected: boolean;
  onPress: () => void;
  onHover?: (hovered: boolean) => void;
}) {
  const colors = useOnboardingColors();
  const { hovered, hoverProps } = useHover();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onHover?.(hovered);
  }, [hovered]);
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={title}>
        {({ pressed }) => (
          <View
            mouseDownCanMoveWindow={false}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              minHeight: 56,
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 12,
              backgroundColor: selected || hovered ? colors.button : colors.row,
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderColor: selected ? colors.checkboxBorder : colors.rowBorder,
              transform: [{ scale: pressed ? 0.99 : 1 }],
            }}
          >
            <Radio on={selected} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 13, fontWeight: "500", color: colors.title }}>{title}</Text>
              <Text numberOfLines={2} style={{ fontSize: 12, color: colors.rowSubtitle }}>
                {subtitle}
              </Text>
            </View>
          </View>
        )}
      </Pressable>
    </View>
  );
}

export function OptionRow<T extends string | number>({
  title,
  value,
  options,
  onChange,
}: {
  title: string;
  value: T;
  options: { value: T; title: string; image?: string | null }[];
  onChange: (value: T) => void;
}) {
  const colors = useOnboardingColors();
  return (
    <RowFrame hovered={false} compact>
      <Text style={{ flex: 1, fontSize: 12.5, fontWeight: "500", color: colors.title }}>{title}</Text>
      <View style={{ flexDirection: "row", gap: 2, padding: 2, borderRadius: 8, backgroundColor: colors.button }} accessibilityRole="radiogroup" accessibilityLabel={title}>
        {options.map((o) => (
          <Segment key={String(o.value)} title={o.title} image={o.image} selected={o.value === value} onPress={() => onChange(o.value)} />
        ))}
      </View>
    </RowFrame>
  );
}

function Segment({ title, image, selected, onPress }: { title: string; image?: string | null; selected: boolean; onPress: () => void }) {
  const colors = useOnboardingColors();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} tooltip={image ? title : undefined}>
      <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={title}>
        {({ pressed }) => (
          <View
            mouseDownCanMoveWindow={false}
            style={{
              height: image ? 30 : 22,
              minWidth: image ? 30 : 34,
              paddingHorizontal: image ? 2 : 8,
              borderRadius: 6,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: selected ? colors.card : hovered ? colors.outlinedHover : "transparent",
              borderWidth: selected ? StyleSheet.hairlineWidth * 2 : 0,
              borderColor: colors.rowBorder,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            }}
          >
            {image ? (
              <Image source={{ uri: image }} style={{ width: 26, height: 26 }} />
            ) : (
              <Text style={{ fontSize: 11.5, fontWeight: selected ? "600" : "500", color: selected ? colors.title : colors.subtitle }}>{title}</Text>
            )}
          </View>
        )}
      </Pressable>
    </View>
  );
}
