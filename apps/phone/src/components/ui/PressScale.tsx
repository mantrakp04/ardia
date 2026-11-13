import { useRef, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { springs } from "./motion";
import { browseLayout } from "./tokens";

type Props = {
  label: string;
  hint?: string;
  onPress: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  grow?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

export function PressScale({ label, hint, onPress, onLongPress, disabled, grow, style, children }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (value: number) => Animated.spring(scale, { toValue: value, ...springs.barPress, useNativeDriver: true }).start();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={hint ? { text: hint } : undefined}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      style={grow ? styles.grow : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => to(browseLayout.barControlScale)}
      onPressOut={() => to(1)}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({ grow: { flex: 1 } });
