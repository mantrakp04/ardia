import { adjustingLightness, parseHex, type Vec4 } from "./colors";

const DEFAULT_TINT: Vec4 = [0.5, 0.5, 0.5, 1];

export const MATERIAL = {
  dark: { material: [68.3 / 255, 68.0 / 255, 68.4 / 255], baseTint: { white: 0, alpha: 0.4 }, gradientOpacity: 0.5 },
  light: { material: [211.2 / 255, 206.7 / 255, 206.0 / 255], baseTint: { white: 1, alpha: 0.8 }, gradientOpacity: 0.75 },
};

export function vibrancyStops(dark: boolean, tintColor: string | undefined, tintAlpha: number, tintLightness: number): [Vec4, Vec4] {
  const m = dark ? MATERIAL.dark : MATERIAL.light;
  const color = (tintColor && parseHex(tintColor)) || DEFAULT_TINT;
  const lighter = adjustingLightness(color, tintLightness);
  const under = m.material.map((v) => m.baseTint.white * m.baseTint.alpha + v * (1 - m.baseTint.alpha));
  const a = tintAlpha * m.gradientOpacity;
  const over = (c: Vec4): Vec4 => [0, 1, 2].map((i) => a * c[i]! + (1 - a) * under[i]!).concat(1) as Vec4;
  return [over(color), over(lighter)];
}
