import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet } from "react-native";
import { springs } from "./motion";
import { useTheme } from "./theme";
import { capsule, ink, shadowRadius, toggleLayout } from "./tokens";

const TRAVEL = toggleLayout.width - toggleLayout.knob - toggleLayout.inset * 2;

export function Toggle({ value, disabled, onChange, label }: { value: boolean; disabled?: boolean; onChange: (value: boolean) => void; label: string }) {
  const theme = useTheme();
  const position = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(position, { toValue: value ? 1 : 0, ...springs.barPress, useNativeDriver: false }).start();
  }, [position, value]);
  const track = position.interpolate({ inputRange: [0, 1], outputRange: [theme.tertiaryFill, theme.switchOn] });
  const knob = position.interpolate({ inputRange: [0, 1], outputRange: [0, TRAVEL] });
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => onChange(!value)}
      style={disabled ? styles.disabled : undefined}
    >
      <Animated.View style={[styles.track, { backgroundColor: track }]}>
        <Animated.View style={[styles.knob, { transform: [{ translateX: knob }] }]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: toggleLayout.width, height: toggleLayout.height, borderRadius: capsule(toggleLayout.height), padding: toggleLayout.inset, justifyContent: "center" },
  knob: {
    width: toggleLayout.knob,
    height: toggleLayout.knob,
    borderRadius: capsule(toggleLayout.knob),
    backgroundColor: ink.white,
    elevation: 2,
    shadowColor: ink.knobShadow,
    shadowOpacity: 1,
    shadowRadius: shadowRadius.knob,
    shadowOffset: { width: 0, height: 1 },
  },
  disabled: { opacity: 0.4 },
});
