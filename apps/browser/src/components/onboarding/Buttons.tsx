import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Symbol, useHover, type SymbolProps } from "../ui";
import { font, weight } from "../ui/tokens";
import { useOnboardingColors } from "./Parts";
import { onboardingButton } from "./tokens";

function PressScale({ title, onPress, disabled, scale, tooltip, children }: { title: string; onPress: () => void; disabled?: boolean; scale: number; tooltip?: string; children: (state: { hovered: boolean; pressed: boolean }) => ReactNode }) {
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} tooltip={tooltip} style={disabled === undefined ? undefined : { opacity: disabled ? onboardingButton.disabledOpacity : 1 }}>
      <Pressable disabled={disabled} onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
        {({ pressed }) => (
          <View mouseDownCanMoveWindow={false} style={{ transform: [{ scale: pressed ? scale : 1 }] }}>
            {children({ hovered, pressed })}
          </View>
        )}
      </Pressable>
    </View>
  );
}

export function PrimaryButton({ title, onPress, disabled, icon }: { title: string; onPress: () => void; disabled?: boolean; icon?: string }) {
  const colors = useOnboardingColors();
  return (
    <PressScale title={title} onPress={onPress} disabled={!!disabled} scale={onboardingButton.pressScale}>
      {({ hovered }) => (
        <View
          style={{
            height: onboardingButton.height,
            borderRadius: onboardingButton.height / 2,
            paddingHorizontal: onboardingButton.primaryPad,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            backgroundColor: hovered && !disabled ? colors.primaryHover : colors.primary,
          }}
        >
          <Text style={{ ...font.body, fontWeight: weight.semibold, color: colors.primaryText }}>{title}</Text>
          {icon ? <Symbol name={icon} size={11} weight="semibold" color={colors.primaryText} style={{ width: 12, height: 12 }} /> : null}
        </View>
      )}
    </PressScale>
  );
}

export function SecondaryButton({ title, onPress, filled }: { title: string; onPress: () => void; filled?: boolean }) {
  const colors = useOnboardingColors();
  return (
    <PressScale title={title} onPress={onPress} scale={onboardingButton.pressScale}>
      {({ hovered }) => (
        <View
          style={{
            height: onboardingButton.height,
            borderRadius: onboardingButton.height / 2,
            paddingHorizontal: onboardingButton.secondaryPad,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: filled ? (hovered ? colors.buttonHover : colors.button) : hovered ? colors.outlinedHover : "transparent",
            borderWidth: filled ? 0 : 1,
            borderColor: colors.noThanksBorder,
          }}
        >
          <Text style={{ ...font.body, fontWeight: weight.medium, color: filled ? colors.buttonText : colors.noThanksText }}>{title}</Text>
        </View>
      )}
    </PressScale>
  );
}

export function CircleButton({
  title,
  icon,
  size,
  symbolWeight,
  box,
  tooltip,
  onPress,
}: {
  title: string;
  icon: string;
  size: number;
  symbolWeight: SymbolProps["weight"];
  box: number;
  tooltip?: string;
  onPress: () => void;
}) {
  const colors = useOnboardingColors();
  return (
    <PressScale title={title} onPress={onPress} scale={onboardingButton.circlePressScale} tooltip={tooltip}>
      {({ hovered }) => (
        <View
          style={{
            width: onboardingButton.height,
            height: onboardingButton.height,
            borderRadius: onboardingButton.height / 2,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: hovered ? colors.outlinedHover : "transparent",
            borderWidth: 1,
            borderColor: colors.noThanksBorder,
          }}
        >
          <Symbol name={icon} size={size} weight={symbolWeight} color={colors.noThanksText} style={{ width: box, height: box }} />
        </View>
      )}
    </PressScale>
  );
}

export function BackButton({ onPress }: { onPress: () => void }) {
  return <CircleButton title="Back" icon="chevron.left" size={12} symbolWeight="semibold" box={14} onPress={onPress} />;
}
