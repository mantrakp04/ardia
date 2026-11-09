import { useEffect, useRef, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Checkbox, IconTile, Radio, Text, useHover } from "../ui";
import { radius, space } from "../ui/tokens";
import { ChoiceCard } from "./ChoiceCard";
import { useOnboardingColors } from "./Parts";

const DISABLED_OPACITY = 0.5;
const RADIO_MIN_HEIGHT = 56;

export function OptionCard({
  title,
  subtitle,
  icon,
  control,
  selected,
  onPress,
  disabled,
  onHover,
  preview,
}: {
  title: string;
  subtitle?: string;
  icon?: string;
  control: "radio" | "check";
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  onHover?: (hovered: boolean) => void;
  preview?: ReactNode;
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

  if (control === "check")
    return (
      <View {...hoverProps} style={{ opacity: disabled ? DISABLED_OPACITY : 1 }}>
        <Pressable disabled={disabled} onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled }} accessibilityLabel={title}>
          <ChoiceCard
            mouseDownCanMoveWindow={false}
            radius={radius.panel}
            hovered={hovered && !disabled}
            raised={false}
            style={{ flexDirection: "row", alignItems: "center", gap: space.l, paddingVertical: space.m, paddingHorizontal: space.l }}
          >
            {icon ? <IconTile symbol={icon} size="m" fill={colors.iconContainer} glyph={colors.title} /> : null}
            <View style={{ flex: 1, gap: space.xxs }}>
              <Text weight="medium" color={colors.title}>
                {title}
              </Text>
              {subtitle ? (
                <Text size="small" lines={2} color={colors.rowSubtitle}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <View pointerEvents="none">
              <Checkbox look="ring" size="m" value={selected} onChange={onPress} />
            </View>
          </ChoiceCard>
        </Pressable>
      </View>
    );

  if (preview)
    return (
      <View {...hoverProps} style={{ flex: 1 }}>
        <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={title}>
          {({ pressed }) => (
            <ChoiceCard mouseDownCanMoveWindow={false} radius={radius.panel} selected={selected} hovered={hovered} style={{ padding: space.ml, gap: space.ml, transform: [{ scale: pressed ? 0.98 : 1 }] }}>
              {preview}
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
                <Radio on={selected} look="ring" />
                <View style={{ flex: 1 }}>
                  <Text size="small" weight="medium" color={colors.title}>
                    {title}
                  </Text>
                  {subtitle ? (
                    <Text size="caption" color={colors.rowSubtitle}>
                      {subtitle}
                    </Text>
                  ) : null}
                </View>
              </View>
            </ChoiceCard>
          )}
        </Pressable>
      </View>
    );

  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={title}>
        {({ pressed }) => (
          <ChoiceCard
            mouseDownCanMoveWindow={false}
            radius={radius.panel}
            selected={selected}
            hovered={hovered}
            outline="soft"
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.l,
              minHeight: RADIO_MIN_HEIGHT,
              paddingVertical: space.ml,
              paddingHorizontal: space.xl,
              transform: [{ scale: pressed ? 0.99 : 1 }],
            }}
          >
            <Radio on={selected} look="ring" />
            <View style={{ flex: 1, gap: space.xxs }}>
              <Text weight="medium" color={colors.title}>
                {title}
              </Text>
              {subtitle ? (
                <Text size="small" lines={2} color={colors.rowSubtitle}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
          </ChoiceCard>
        )}
      </Pressable>
    </View>
  );
}
