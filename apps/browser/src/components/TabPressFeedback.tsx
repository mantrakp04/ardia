import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Animated, Easing, type StyleProp, type ViewStyle } from "react-native";
import { tabPressMotion } from "./tabPressMotion";

export function TabPressFeedback({ pressed, children, style }: { pressed: boolean; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const progress = useRef(new Animated.Value(0)).current;
  const reduceMotion = useSyncExternalStore(tabPressMotion.subscribe, tabPressMotion.getSnapshot);
  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: pressed ? 1 : 0,
      duration: reduceMotion ? 0 : pressed ? 80 : 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [pressed, reduceMotion, progress]);
  return (
    <Animated.View
      style={[style, {
        opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.95] }),
        transform: [{ scale: reduceMotion ? 1 : progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.99] }) }],
      }]}
    >
      {children}
    </Animated.View>
  );
}
