import { StyleSheet, type ViewStyle } from "react-native";

export type Geo = { s: number; W: number; H: number };
export type Rect = { x: number; y: number; w: number; h: number };

export const DESIGN = { width: 860, height: 600 } as const;

export function geo(width: number, height: number): Geo {
  const s = Math.min(width / DESIGN.width, height / DESIGN.height);
  return { s, W: width / s, H: height / s };
}

export const SIDEBAR_W = 190;
export const ROW = { x: 6, w: 178, h: 34, pitch: 37, top: 62, topWithField: 94 } as const;
export const FIELD: Rect = { x: 6, y: 46, w: 178, h: 34 };
export const TOOLBAR_H = 41;
export const CRUMB_X = 153;
export const STRIP_H = 42;
export const CHIP = { x: 76, w: 173, gap: 4, top: 5, h: 32 } as const;
export const LIGHTS_Y = { toolbar: 27, field: 24, strip: 20.75 } as const;
export const TOOLBAR_ICONS = [21, 56, 92, 127] as const;
export const SIDEBAR_ICONS = [98, 133, 168] as const;
export const rowY = (i: number, top: number = ROW.top) => top + i * ROW.pitch;

export const sideCard = (g: Geo): Rect => ({ x: SIDEBAR_W + 7, y: 6, w: g.W - SIDEBAR_W - 14, h: g.H - 13 });
export const topCard = (g: Geo): Rect => ({ x: 6, y: STRIP_H, w: g.W - 12, h: g.H - STRIP_H - 6 });

export const at = (g: Geo, x: number, y: number, w: number, h: number): ViewStyle => ({ position: "absolute", left: x * g.s, top: y * g.s, width: w * g.s, height: h * g.s });
export const atRect = (g: Geo, r: Rect) => at(g, r.x, r.y, r.w, r.h);
export const hairline = StyleSheet.hairlineWidth;
export const fill = StyleSheet.absoluteFill;
