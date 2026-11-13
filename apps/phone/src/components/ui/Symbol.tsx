import Svg, { Path } from "react-native-svg";
import { SYMBOLS, type SymbolName } from "./symbolPaths";

export function Symbol({ name, size, color }: { name: SymbolName; size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {SYMBOLS[name].map((layer, index) => (
        <Path
          key={index}
          d={layer.d}
          fill={"fill" in layer && layer.fill ? color : "none"}
          fillRule={"evenOdd" in layer && layer.evenOdd ? "evenodd" : "nonzero"}
          stroke={"stroke" in layer ? color : "none"}
          strokeWidth={"stroke" in layer ? layer.stroke : 0}
          strokeLinecap="round"
          strokeLinejoin="round"
          rotation={"rotate" in layer ? layer.rotate : 0}
          origin="12, 12"
        />
      ))}
    </Svg>
  );
}
