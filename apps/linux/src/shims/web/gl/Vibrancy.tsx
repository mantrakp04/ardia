import type { CSSProperties } from "react";
import { displayP3 } from "./colors";
import { vibrancyStops } from "./material";

const fill: CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none" };

type Props = { dark: boolean; tintColor?: string; tintAlpha?: number; tintLightness?: number };

export function Vibrancy({ dark, tintColor, tintAlpha = 0.36, tintLightness = 0.25 }: Props) {
  const [top, bottom] = vibrancyStops(dark, tintColor, tintAlpha, tintLightness);
  return <div style={{ ...fill, background: `linear-gradient(to bottom in display-p3, ${displayP3(top, 1)}, ${displayP3(bottom, 1)})` }} />;
}
