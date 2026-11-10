import { processColor, TurboModuleRegistry, type TurboModule, type ViewProps } from "react-native";
import * as NativeComponentRegistry from "react-native/Libraries/NativeComponent/NativeComponentRegistry";

export type MaterialCapabilities = {
  build: number;
  systemBackdrop: boolean;
  systemBackdropSupported: boolean;
  inWindowBlur: boolean;
  gradient: boolean;
  background: boolean;
};

export type MaterialPath = { path: string; reason: string; step?: string };

export type MaterialsNative = {
  capabilities(): MaterialCapabilities;
  applyWindowMaterial(windowId: string, material: string): Promise<MaterialPath>;
  clearWindowMaterial(windowId: string): Promise<boolean>;
  probeBlur(): Promise<MaterialPath>;
  probeGradient(): Promise<MaterialPath>;
};

export type WindowMaterialKind = "micaAlt" | "mica" | "acrylic";

export type NativeWindowMaterialProps = ViewProps & { material: WindowMaterialKind; fallbackColor: string; tintColor: string };

export type NativeMaterialBlurProps = ViewProps & {
  fallbackColor: string;
  tintColor: string;
  blurRadius: number;
  saturation: number;
  cornerRadius?: number;
  shape?: string;
};

export type GradientSpan = "unit" | "base" | "corner";

export type NativeMaterialGradientProps = ViewProps & { colors: number[]; angle: number; span: GradientSpan; reach: number };

const colorAttribute = { process: processColor as (value: never) => unknown };

export const NativeWindowMaterial = NativeComponentRegistry.get<NativeWindowMaterialProps>("ArdiaWindowMaterial", () => ({
  uiViewClassName: "ArdiaWindowMaterial",
  validAttributes: { material: true, fallbackColor: colorAttribute, tintColor: colorAttribute },
}));

export const NativeMaterialBlur = NativeComponentRegistry.get<NativeMaterialBlurProps>("ArdiaMaterialBlur", () => ({
  uiViewClassName: "ArdiaMaterialBlur",
  validAttributes: { fallbackColor: colorAttribute, tintColor: colorAttribute, blurRadius: true, saturation: true, cornerRadius: true, shape: true },
}));

export const NativeMaterialGradient = NativeComponentRegistry.get<NativeMaterialGradientProps>("ArdiaMaterialGradient", () => ({
  uiViewClassName: "ArdiaMaterialGradient",
  validAttributes: { colors: true, angle: true, span: true, reach: true },
}));

let capabilities: MaterialCapabilities | null | undefined;

export function materialCapabilities(): MaterialCapabilities | null {
  if (capabilities !== undefined) return capabilities;
  capabilities = null;
  try {
    const native = TurboModuleRegistry.get<TurboModule & MaterialsNative>("ArdiaMaterials");
    const answer = native?.capabilities?.();
    if (answer && typeof answer === "object" && typeof answer.build === "number") capabilities = answer;
  } catch {
    capabilities = null;
  }
  return capabilities;
}

export const nativeWindowMaterial = () => materialCapabilities() !== null;

export const nativeBlur = () => materialCapabilities()?.inWindowBlur === true;

export const nativeGradient = () => materialCapabilities()?.gradient === true;

type Point = [number, number];

const ARROW_BASE_ROUNDING = 3;
const ARROW_TIP_ROUNDING = 2.5;

const toward = (from: Point, to: Point, distance: number): Point => {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (length === 0) return from;
  const k = Math.min(distance, length / 2) / length;
  return [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k];
};

const number = (value: number) => String(Math.round(value * 100) / 100);

export function bubblePath(width: number, height: number, cornerRadius: number, edge: "top" | "bottom" | "none", arrowX: number, arrowWidth: number, arrowHeight: number): string {
  if (!(width > 0 && height > 0)) return "";
  const lift = edge === "none" ? 0 : Math.min(Math.max(0, arrowHeight), height);
  const top = lift;
  const bottom = height;
  const radius = Math.max(0, Math.min(cornerRadius, width / 2, (bottom - top) / 2));
  const half = Math.max(0, arrowWidth) / 2;
  const flip = edge === "bottom";
  const at = ([x, y]: Point) => `${number(x)} ${number(flip ? height - y : y)}`;
  const sweep = flip ? 0 : 1;
  const corner = (to: Point) => (radius > 0 ? `A ${number(radius)} ${number(radius)} 0 0 ${sweep} ${at(to)}` : `L ${at(to)}`);
  const parts = [`M ${at([radius, top])}`];
  if (edge !== "none" && half > 0 && lift > 0 && width >= 2 * (radius + half)) {
    const x = Math.min(Math.max(arrowX, radius + half), width - radius - half);
    const left: Point = [x - half, top];
    const tip: Point = [x, 0];
    const right: Point = [x + half, top];
    parts.push(`L ${at(toward(left, [radius, top], ARROW_BASE_ROUNDING))}`, `Q ${at(left)} ${at(toward(left, tip, ARROW_BASE_ROUNDING))}`);
    parts.push(`L ${at(toward(tip, left, ARROW_TIP_ROUNDING))}`, `Q ${at(tip)} ${at(toward(tip, right, ARROW_TIP_ROUNDING))}`);
    parts.push(`L ${at(toward(right, tip, ARROW_BASE_ROUNDING))}`, `Q ${at(right)} ${at(toward(right, [width - radius, top], ARROW_BASE_ROUNDING))}`);
  }
  parts.push(`L ${at([width - radius, top])}`, corner([width, top + radius]));
  parts.push(`L ${at([width, bottom - radius])}`, corner([width - radius, bottom]));
  parts.push(`L ${at([radius, bottom])}`, corner([0, bottom - radius]));
  parts.push(`L ${at([0, top + radius])}`, corner([radius, top]), "Z");
  return parts.join(" ");
}
