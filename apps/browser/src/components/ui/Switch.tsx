import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, View, type EasingFunction } from "react-native";
import { curve, duration } from "./motion";
import { useTheme } from "./theme";
import { ink, opacity } from "./tokens";

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
  look,
  hitSlop = 6,
  animateExternalChanges = true,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
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
      disabled={disabled}
      hitSlop={hitSlop}
      onPress={() => {
        const next = !target.current;
        pressedAt.current = Date.now();
        slideTo(next);
        onChange(next);
      }}
      style={{ opacity: disabled ? opacity.disabled : 1 }}
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
            backgroundColor: ink.white,
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

export function Toggle({ value, onChange, disabled, look = "form" }: { value: boolean; onChange: (value: boolean) => void; disabled?: boolean; look?: "form" | "panel" }) {
  const theme = useTheme();
  if (look === "panel")
    return (
      <Switch
        value={value}
        onChange={onChange}
        disabled={disabled}
        look={{ width: 30, height: 17, knob: 14, inset: 1.5, offColor: theme.toggleOff, onColor: theme.accent, duration: duration.quick, easing: curve.outQuad }}
      />
    );
  return (
    <Switch
      value={value}
      onChange={onChange}
      disabled={disabled}
      animateExternalChanges={false}
      look={{ width: 32, height: 18, knob: 15, inset: 1.5, offColor: theme.switchOff, onColor: theme.formAccent, knobBorder: theme.knobBorder, duration: duration.toggle, easing: curve.outCubic }}
    />
  );
}
