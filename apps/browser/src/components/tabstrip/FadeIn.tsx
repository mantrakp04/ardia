import { useEffect, useRef } from "react";
import { Animated } from "react-native";
import { curve } from "../ui/motion";
import { FADE_IN_MS } from "./tokens";

export function FadeIn({ style, children }: { style: object; children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: FADE_IN_MS, easing: curve.outQuad, useNativeDriver: false }).start();
  }, []);
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", ...style, opacity }}>
      {children}
    </Animated.View>
  );
}
