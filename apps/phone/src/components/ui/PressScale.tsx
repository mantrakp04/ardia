import { useRef, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { springs } from "./motion";
import { browseLayout } from "./tokens";

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  grow?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

export function PressScale({ label, onPress, disabled, grow, style, children }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (value: number) => Animated.spring(scale, { toValue: value, ...springs.barPress, useNativeDriver: true }).start();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      style={grow ? styles.grow : undefined}
      onPress={onPress}
      onPressIn={() => to(browseLayout.barControlScale)}
      onPressOut={() => to(1)}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({ grow: { flex: 1 } });
