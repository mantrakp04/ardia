import { StyleSheet } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

export function Backdrop({ colors, diagonal = false }: { colors: readonly string[]; diagonal?: boolean }) {
  const last = Math.max(1, colors.length - 1);
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id="backdrop" x1="0" y1="0" x2={diagonal ? "1" : "0"} y2="1">
          {colors.map((color, index) => (
            <Stop key={index} offset={index / last} stopColor={color} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#backdrop)" />
    </Svg>
  );
}
