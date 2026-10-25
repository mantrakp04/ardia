import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, View, type EasingFunction } from "react-native";

export type SwitchLook = {
  width: number;
  height: number;
  knob: number;
  inset: number;
  offColor: string;
  onColor: string;
  knobBorder?: string;
  duration: number;
  easing: EasingFunction;
};

export function Switch({
  value,
  onChange,
  disabled,
  accessibilityLabel,
  look,
  hitSlop = 6,
  animateExternalChanges = true,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  look: SwitchLook;
  hitSlop?: number;
  animateExternalChanges?: boolean;
}) {
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;
  const target = useRef(value);
  const pressedAt = useRef(0);

  const slideTo = (on: boolean) => {
    if (target.current === on) return;
    target.current = on;
    Animated.timing(progress, { toValue: on ? 1 : 0, duration: look.duration, easing: look.easing, useNativeDriver: true }).start();
  };

  const jumpTo = (on: boolean) => {
    if (target.current === on) return;
    target.current = on;
    progress.stopAnimation();
    progress.setValue(on ? 1 : 0);
  };

  useEffect(() => (animateExternalChanges || Date.now() - pressedAt.current < USER_CHANGE_WINDOW_MS ? slideTo(value) : jumpTo(value)));

  const travel = look.width - look.knob - look.inset * 2;
  const radius = look.height / 2;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      hitSlop={hitSlop}
      onPress={() => {
        const next = !target.current;
        pressedAt.current = Date.now();
        slideTo(next);
        onChange(next);
      }}
      style={{ opacity: disabled ? 0.45 : 1 }}
    >
      <View pointerEvents="none" style={{ width: look.width, height: look.height, borderRadius: radius, backgroundColor: look.offColor, overflow: "hidden" }}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: look.onColor, opacity: progress }]} />
        <Animated.View
          style={{
            position: "absolute",
            top: look.inset,
            left: look.inset,
            width: look.knob,
            height: look.knob,
            borderRadius: look.knob / 2,
            backgroundColor: "#FFFFFF",
            borderWidth: look.knobBorder ? StyleSheet.hairlineWidth : 0,
            borderColor: look.knobBorder,
            transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, travel] }) }],
          }}
        />
      </View>
    </Pressable>
  );
}

const USER_CHANGE_WINDOW_MS = 2000;

export const switchEasing = { cubicOut: Easing.out(Easing.cubic), quadOut: Easing.out(Easing.quad) };
