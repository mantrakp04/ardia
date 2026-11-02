import { useEffect, useRef, type ReactNode } from "react";
import { Animated, View } from "react-native";
import { curve, duration } from "./motion";
import { capsule, swatch } from "./tokens";
import { useHover } from "./useHover";

const RING = { padding: swatch.inset, borderWidth: swatch.ring } as const;
const DISC = { flex: 1, overflow: "hidden" } as const;
const LIVELY = { restInset: swatch.inset + swatch.ring, hoverInset: swatch.ring + 1, selectedInset: 2 * (swatch.inset + swatch.ring) - swatch.ring, restOpacity: 0.85 } as const;

export function Swatch({
  selected,
  ring,
  fill,
  size = swatch.size,
  animated = false,
  children,
}: {
  selected: boolean;
  ring: string;
  fill?: string;
  size?: number;
  animated?: boolean;
  children?: ReactNode;
}) {
  if (animated)
    return (
      <LivelySwatch selected={selected} ring={ring} fill={fill} size={size}>
        {children}
      </LivelySwatch>
    );
  return (
    <View style={[RING, { width: size, height: size, borderRadius: capsule(size), borderColor: selected ? ring : "transparent" }]}>
      <View style={[DISC, { borderRadius: capsule(size) - swatch.inset, backgroundColor: fill }]}>{children}</View>
    </View>
  );
}

function LivelySwatch({ selected, ring, fill, size, children }: { selected: boolean; ring: string; fill?: string; size: number; children?: ReactNode }) {
  const { hovered, hoverProps } = useHover();
  const t = useRef(new Animated.Value(selected ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: selected ? 1 : 0, duration: duration.base, easing: curve.enter, useNativeDriver: false }).start();
  }, [selected]);
  const disc = t.interpolate({ inputRange: [0, 1], outputRange: [size - 2 * (hovered ? LIVELY.hoverInset : LIVELY.restInset), size - 2 * LIVELY.selectedInset] });
  return (
    <View {...hoverProps} style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{ position: "absolute", width: size, height: size, borderRadius: capsule(size), borderWidth: swatch.ring, borderColor: ring, opacity: t }} />
      <Animated.View style={{ width: disc, height: disc, borderRadius: capsule(size), overflow: "hidden", backgroundColor: fill, opacity: hovered || selected ? 1 : LIVELY.restOpacity }}>{children}</Animated.View>
    </View>
  );
}
