import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Image, Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../ui/theme";
import { IconRing } from "./GlassBacking";
import type { TileTheme } from "../../state/favicons/tileTheme";
import { Checkbox, Dot, Text, useHover } from "../ui";
import { activeSteps, useOnboarding, type OnboardingStep } from "../../state/onboarding/onboarding";
import { useQuestions } from "../../state/onboarding/questions";
import { curve } from "../ui/motion";
import { capsule, concentric, radius, space, tracking } from "../ui/tokens";
import { onboardingColorsOf, onboardingMotion, onboardingType, TILE_WIDTH } from "./tokens";
import { CARD_BORDER, ChoiceCard, SELECTED_BORDER } from "./ChoiceCard";

export const useOnboardingColors = () => onboardingColorsOf(useTheme());

export function Reveal({ delay = 0, children, style }: { delay?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: onboardingMotion.reveal, delay, easing: curve.enter, useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View style={[style, { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

const STEP_BAR = { width: 22, height: 3 } as const;
const STEP_DOT = 5;

export function StepDots({ count, index, shape }: { count: number; index: number; shape: "bar" | "dot" }) {
  const colors = useOnboardingColors();
  if (shape === "bar")
    return (
      <View style={{ flexDirection: "row", gap: space.xs }}>
        {Array.from({ length: count }, (_, i) => (
          <View key={i} style={{ ...STEP_BAR, borderRadius: capsule(STEP_BAR.height), backgroundColor: i <= index ? colors.progressFill : colors.progressTrack }} />
        ))}
      </View>
    );
  return (
    <View style={{ flexDirection: "row", gap: space.xs }}>
      {Array.from({ length: count }, (_, i) => (
        <Dot key={i} size={STEP_DOT} color={i <= index ? colors.title : colors.progressTrack} style={{ opacity: i < index ? 0.45 : 1 }} />
      ))}
    </View>
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
    <View style={{ gap: space.m }}>
      <StepDots count={steps.length} index={index} shape="bar" />
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.ml, height: 14 }}>
        <Text size="caption" weight="medium" color={colors.steps} style={{ letterSpacing: tracking.caps }}>{`STEP ${index + 1} OF ${steps.length}`}</Text>
        {count > 1 ? (
          <View accessibilityLabel={`Question ${sub + 1} of ${count}`}>
            <StepDots count={count} index={sub} shape="dot" />
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function StepTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  const colors = useOnboardingColors();
  return (
    <View style={{ gap: space.ml }}>
      <Text color={colors.title} style={onboardingType.stepTitle}>
        {title}
      </Text>
      {subtitle ? (
        <Text color={colors.subtitle} style={onboardingType.stepSubtitle}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const TAG_HEIGHT = 20;

export function Tag({ title }: { title: string }) {
  const colors = useOnboardingColors();
  return (
    <View style={{ height: TAG_HEIGHT, paddingHorizontal: space.m, borderRadius: capsule(TAG_HEIGHT), justifyContent: "center", backgroundColor: colors.button }}>
      <Text size="caption" weight="semibold" color={colors.title}>
        {title}
      </Text>
    </View>
  );
}

export function SectionLabel({ title, accessory }: { title: string; accessory?: ReactNode }) {
  const colors = useOnboardingColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 18 }}>
      <Text size="small" weight="medium" color={colors.subtitle}>
        {title}
      </Text>
      {accessory}
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
    <ChoiceCard mouseDownCanMoveWindow={false} radius={radius.panel} style={{ flexDirection: "row", alignItems: "center", gap: space.ml, minHeight: 36, paddingVertical: space.s, paddingHorizontal: space.l }}>
      <Text size="small" weight="medium" color={colors.title} style={{ flex: 1 }}>
        {title}
      </Text>
      <ChoiceCard
        radius={radius.tile}
        fill={colors.button}
        border={null}
        style={{ flexDirection: "row", gap: space.xxs, padding: space.xxs }}
        accessibilityRole="radiogroup"
        accessibilityLabel={title}
      >
        {options.map((o) => (
          <Segment key={String(o.value)} title={o.title} image={o.image} selected={o.value === value} onPress={() => onChange(o.value)} />
        ))}
      </ChoiceCard>
    </ChoiceCard>
  );
}

const SEGMENT = { height: 22, minWidth: 34, imageBox: 30, image: 26 } as const;

function Segment({ title, image, selected, onPress }: { title: string; image?: string | null; selected: boolean; onPress: () => void }) {
  const colors = useOnboardingColors();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} tooltip={image ? title : undefined}>
      <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={title}>
        {({ pressed }) => (
          <ChoiceCard
            mouseDownCanMoveWindow={false}
            radius={concentric(radius.tile, space.xxs)}
            raised
            plain={!selected}
            fill={selected ? colors.card : hovered ? colors.outlinedHover : "transparent"}
            border={selected ? colors.rowBorder : null}
            style={{
              height: image ? SEGMENT.imageBox : SEGMENT.height,
              minWidth: image ? SEGMENT.imageBox : SEGMENT.minWidth,
              paddingHorizontal: image ? space.xxs : space.m,
              alignItems: "center",
              justifyContent: "center",
              transform: [{ scale: pressed ? 0.96 : 1 }],
            }}
          >
            {image ? (
              <Image source={{ uri: image }} style={{ width: SEGMENT.image, height: SEGMENT.image }} />
            ) : (
              <Text size="caption" weight={selected ? "semibold" : "medium"} color={selected ? colors.title : colors.subtitle}>
                {title}
              </Text>
            )}
          </ChoiceCard>
        )}
      </Pressable>
    </View>
  );
}

const TILE_CHECK_INSET = 5;

export function SelectTile({
  title,
  width = TILE_WIDTH,
  height,
  selected,
  role,
  titlePad,
  titleLines,
  ring,
  onPress,
  children,
}: {
  title: string;
  width?: number;
  height: number;
  selected: boolean;
  role: "radio" | "checkbox";
  titlePad?: number;
  titleLines?: number;
  ring?: TileTheme | null;
  onPress: () => void;
  children: (hovered: boolean) => ReactNode;
}) {
  const colors = useOnboardingColors();
  const { hovered, hoverProps } = useHover();
  const state = role === "radio" ? { selected } : { checked: selected };
  const ringed = selected && !!ring;
  const border = selected ? SELECTED_BORDER : CARD_BORDER;
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress} accessibilityRole={role} accessibilityState={state} accessibilityLabel={title}>
        {({ pressed }) => (
          <ChoiceCard
            mouseDownCanMoveWindow={false}
            radius={radius.panel}
            selected={selected}
            hovered={hovered}
            border={ringed ? "transparent" : undefined}
            style={{ width, height, alignItems: "center", justifyContent: "center", gap: space.s, transform: [{ scale: pressed ? 0.96 : 1 }] }}
          >
            {ringed ? (
              <View pointerEvents="none" style={{ position: "absolute", top: -border, left: -border, right: -border, bottom: -border }}>
                <IconRing ring={ring} />
              </View>
            ) : null}
            {children(hovered)}
            <Text size="caption" weight="medium" lines={titleLines} color={selected ? colors.title : colors.subtitle} style={{ paddingHorizontal: titlePad }}>
              {title}
            </Text>
            {selected ? (
              <View pointerEvents="none" style={{ position: "absolute", top: TILE_CHECK_INSET, right: TILE_CHECK_INSET }}>
                <Checkbox look="ring" size="s" value onChange={onPress} />
              </View>
            ) : null}
          </ChoiceCard>
        )}
      </Pressable>
    </View>
  );
}
