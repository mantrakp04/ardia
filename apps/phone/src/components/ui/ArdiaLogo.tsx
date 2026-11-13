import Svg, { Defs, G, LinearGradient, Path, Stop } from "react-native-svg";
import { logoInk } from "./tokens";

const CANVAS = { left: 26, top: 186, width: 972, height: 772 };
const OUTLINE = 0.05;

const SHAPES = [
  { id: "sun", d: "M432 316a124 124 0 1 0 248 0a124 124 0 1 0-248 0Z", top: 192, bottom: 440, ink: logoInk.sun },
  {
    id: "backHill",
    d: "M66 828C22 700 40 520 150 430C210 375 300 352 372 388C460 425 530 486 610 548L640 780L300 820Z",
    top: 352,
    bottom: 828,
    ink: logoInk.backHill,
  },
  {
    id: "frontHill",
    d: "M68 834C250 700 500 556 690 466C770 432 868 424 935 482C1004 545 1000 705 978 820C962 902 922 952 842 952L204 952C124 950 70 904 68 834Z",
    top: 424,
    bottom: 952,
    ink: logoInk.frontHill,
  },
] as const;

export function ArdiaLogo({ width }: { width: number }) {
  const stroke = CANVAS.width * OUTLINE;
  const pad = stroke / 2 + 2;
  const box = `${CANVAS.left - pad} ${CANVAS.top - pad} ${CANVAS.width + pad * 2} ${CANVAS.height + pad * 2}`;
  const height = (width * (CANVAS.height + pad * 2)) / (CANVAS.width + pad * 2);
  return (
    <Svg width={width} height={height} viewBox={box}>
      <Defs>
        {SHAPES.map((shape) => (
          <LinearGradient key={shape.id} id={shape.id} x1="0" y1={shape.top} x2="0" y2={shape.bottom} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={shape.ink[0]} />
            <Stop offset="1" stopColor={shape.ink[1]} />
          </LinearGradient>
        ))}
      </Defs>
      <G>
        {SHAPES.map((shape) => (
          <Path key={`outline-${shape.id}`} d={shape.d} fill={logoInk.outline} stroke={logoInk.outline} strokeWidth={stroke} strokeLinejoin="round" />
        ))}
        {SHAPES.map((shape) => (
          <Path key={shape.id} d={shape.d} fill={`url(#${shape.id})`} />
        ))}
      </G>
    </Svg>
  );
}
