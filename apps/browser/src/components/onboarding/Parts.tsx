import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../ui/theme";
import { onboardingColors } from "./tokens";
import { GlassBacking, IconRing, useSolidFill } from "./GlassBacking";
import type { TileTheme } from "../../state/favicons/tileTheme";
import { Radio, Symbol, useHover } from "../ui";
import { activeSteps, useOnboarding, type OnboardingStep } from "../../state/onboarding/onboarding";
import { useQuestions } from "../../state/onboarding/questions";
import { curve } from "../ui/motion";
import { font, weight } from "../ui/tokens";
import { onboardingMotion, onboardingType } from "./tokens";

export const useOnboardingColors = () => (useTheme().dark ? onboardingColors.dark : onboardingColors.light);

export function Reveal({ delay = 0, children, style }: { delay?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: onboardingMotion.reveal, delay, easing: curve.outCubic, useNativeDriver: true }).start();
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
  const count = useQuestions(step).length;
  const steps: OnboardingStep[] = activeSteps().filter((s) => s !== "intro");
  const index = steps.indexOf(step);
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", gap: 4 }}>
        {steps.map((s, i) => (
          <View key={s} style={{ width: 22, height: 3, borderRadius: 1.5, backgroundColor: i <= index ? colors.progressFill : colors.progressTrack }} />
        ))}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, height: 14 }}>
        <Text style={{ ...font.caption, fontWeight: weight.medium, letterSpacing: 0.2, color: colors.steps }}>{`STEP ${index + 1} OF ${steps.length}`}</Text>
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
      <Text style={{ ...onboardingType.stepTitle, color: colors.title }}>{title}</Text>
      {subtitle ? <Text style={{ ...onboardingType.stepSubtitle, color: colors.subtitle }}>{subtitle}</Text> : null}
    </View>
  );
}

export function CheckMark({ on, size = 18 }: { on: boolean; size?: number }) {
  const colors = useOnboardingColors();
  const t = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: on ? 1 : 0, duration: onboardingMotion.checkMark, easing: curve.outQuad, useNativeDriver: true }).start();
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

export function Tag({ title }: { title: string }) {
  const colors = useOnboardingColors();
  return (
    <View style={{ height: 20, paddingHorizontal: 8, borderRadius: 10, justifyContent: "center", backgroundColor: colors.button }}>
      <Text style={{ ...font.caption, fontWeight: weight.semibold, color: colors.title }}>{title}</Text>
    </View>
  );
}

export function SectionLabel({ title, accessory }: { title: string; accessory?: ReactNode }) {
  const colors = useOnboardingColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 18 }}>
      <Text style={{ ...font.small, fontWeight: weight.medium, color: colors.subtitle }}>{title}</Text>
      {accessory}
    </View>
  );
}

function RowFrame({ children, hovered, disabled, compact }: { children: ReactNode; hovered: boolean; disabled?: boolean; compact?: boolean }) {
  const solidFill = useSolidFill();
  const colors = useOnboardingColors();
  const fill = hovered && !disabled ? colors.button : colors.row;
  const radius = compact ? 10 : 12;
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
        borderRadius: radius,
        backgroundColor: solidFill(fill),
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: colors.rowBorder,
      }}
    >
      <GlassBacking radius={radius} border={StyleSheet.hairlineWidth * 2} highlight={hovered && !disabled ? colors.outlinedHover : null} />
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
            <Text style={{ ...(compact ? onboardingType.bodyCompact : font.body), fontWeight: weight.medium, color: colors.title }}>{title}</Text>
            {subtitle ? (
              <Text numberOfLines={2} style={{ ...(compact ? font.caption : font.small), color: colors.rowSubtitle }}>
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
  const solidFill = useSolidFill();
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
              backgroundColor: solidFill(selected || hovered ? colors.button : colors.row),
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderColor: selected ? colors.checkboxBorder : colors.rowBorder,
              transform: [{ scale: pressed ? 0.99 : 1 }],
            }}
          >
            <GlassBacking radius={12} border={StyleSheet.hairlineWidth * 2} raised={selected} highlight={selected || hovered ? colors.outlinedHover : null} />
            <Radio on={selected} look="ring" />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ ...font.body, fontWeight: weight.medium, color: colors.title }}>{title}</Text>
              <Text numberOfLines={2} style={{ ...font.small, color: colors.rowSubtitle }}>
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
  const solidFill = useSolidFill();
  const colors = useOnboardingColors();
  return (
    <RowFrame hovered={false} compact>
      <Text style={{ flex: 1, ...onboardingType.bodyCompact, fontWeight: weight.medium, color: colors.title }}>{title}</Text>
      <View style={{ flexDirection: "row", gap: 2, padding: 2, borderRadius: 8, backgroundColor: solidFill(colors.button) }} accessibilityRole="radiogroup" accessibilityLabel={title}>
        <GlassBacking radius={8} />
        {options.map((o) => (
          <Segment key={String(o.value)} title={o.title} image={o.image} selected={o.value === value} onPress={() => onChange(o.value)} />
        ))}
      </View>
    </RowFrame>
  );
}

function Segment({ title, image, selected, onPress }: { title: string; image?: string | null; selected: boolean; onPress: () => void }) {
  const solidFill = useSolidFill();
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
              backgroundColor: selected ? solidFill(colors.card) : hovered ? colors.outlinedHover : "transparent",
              borderWidth: selected ? StyleSheet.hairlineWidth * 2 : 0,
              borderColor: colors.rowBorder,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            }}
          >
            {selected ? <GlassBacking radius={6} border={StyleSheet.hairlineWidth * 2} raised /> : null}
            {image ? (
              <Image source={{ uri: image }} style={{ width: 26, height: 26 }} />
            ) : (
              <Text style={{ ...font.footnote, fontWeight: selected ? weight.semibold : weight.medium, color: selected ? colors.title : colors.subtitle }}>{title}</Text>
            )}
          </View>
        )}
      </Pressable>
    </View>
  );
}

export function SelectTile({
  title,
  width,
  height,
  gap,
  checkSize,
  selected,
  role,
  titlePad,
  titleLines,
  ring,
  onPress,
  children,
}: {
  title: string;
  width: number;
  height: number;
  gap: number;
  checkSize: number;
  selected: boolean;
  role: "radio" | "checkbox";
  titlePad?: number;
  titleLines?: number;
  ring?: TileTheme | null;
  onPress: () => void;
  children: (hovered: boolean) => ReactNode;
}) {
  const solidFill = useSolidFill();
  const colors = useOnboardingColors();
  const { hovered, hoverProps } = useHover();
  const state = role === "radio" ? { selected } : { checked: selected };
  const fill = selected || hovered ? colors.button : colors.row;
  const ringed = selected && !!ring;
  const border = selected ? 1.5 : StyleSheet.hairlineWidth * 2;
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress} accessibilityRole={role} accessibilityState={state} accessibilityLabel={title}>
        {({ pressed }) => (
          <View
            mouseDownCanMoveWindow={false}
            style={{
              width,
              height,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              gap,
              backgroundColor: solidFill(fill),
              borderWidth: border,
              borderColor: ringed ? "transparent" : selected ? colors.title : colors.rowBorder,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            }}
          >
            <GlassBacking radius={12} border={border} raised={selected} highlight={selected || hovered ? colors.outlinedHover : null} />
            {ringed ? (
              <View pointerEvents="none" style={{ position: "absolute", top: -border, left: -border, right: -border, bottom: -border }}>
                <IconRing ring={ring} radius={12} />
              </View>
            ) : null}
            {children(hovered)}
            <Text numberOfLines={titleLines} style={{ ...font.caption, fontWeight: weight.medium, paddingHorizontal: titlePad, color: selected ? colors.title : colors.subtitle }}>
              {title}
            </Text>
            {selected ? (
              <View style={{ position: "absolute", top: 5, right: 5 }}>
                <CheckMark on size={checkSize} />
              </View>
            ) : null}
          </View>
        )}
      </Pressable>
    </View>
  );
}
