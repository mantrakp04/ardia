import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { curve, delay, duration } from "./motion";
import { browseLayout } from "./tokens";

export function LoadingLine({ progress, isLoading, color }: { progress: number; isLoading: boolean; color: string }) {
  const [width, setWidth] = useState(0);
  const fraction = useRef(new Animated.Value(0)).current;
  const alpha = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isLoading) {
      const reveal = setTimeout(() => {
        Animated.timing(alpha, { toValue: 1, duration: duration.progressFill, easing: curve.easeOut, useNativeDriver: false }).start();
      }, delay.progressReveal);
      Animated.timing(fraction, { toValue: Math.max(0.1, progress), duration: duration.progressAdvance, easing: curve.easeOut, useNativeDriver: false }).start();
      return () => clearTimeout(reveal);
    }
    Animated.sequence([
      Animated.timing(fraction, { toValue: 1, duration: duration.progressFill, easing: curve.easeOut, useNativeDriver: false }),
      Animated.timing(alpha, { toValue: 0, duration: duration.progressFade, easing: curve.easeOut, useNativeDriver: false }),
    ]).start(({ finished }) => {
      if (finished) fraction.setValue(0);
    });
    return undefined;
  }, [alpha, fraction, isLoading, progress]);

  return (
    <View style={styles.track} pointerEvents="none" onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <Animated.View
        style={{
          height: browseLayout.progressHeight,
          backgroundColor: color,
          opacity: alpha,
          width: fraction.interpolate({ inputRange: [0, 1], outputRange: [0, width] }),
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({ track: { height: browseLayout.progressHeight, width: "100%" } });
