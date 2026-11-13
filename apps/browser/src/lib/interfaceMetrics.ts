export const INTERFACE_SIZES = ["100", "110", "125", "150"] as const;
export type InterfaceSize = typeof INTERFACE_SIZES[number];
export const normalizeInterfaceSize = (value: unknown): InterfaceSize => INTERFACE_SIZES.includes(value as InterfaceSize) ? value as InterfaceSize : "100";
const factors = { "100": 1, "110": 1.1, "125": 1.25, "150": 1.5 } as const;
const metrics = Object.fromEntries(INTERFACE_SIZES.map((preset) => {
  const factor = factors[preset];
  return [preset, Object.freeze({ preset, factor, rowHeight: 34 * factor, rowGap: 3 * factor, groupBorder: 0.5 * factor, groupPad: 2.5 * factor, topStripHeight: 42 * factor })];
})) as Record<InterfaceSize, Readonly<{ preset: InterfaceSize; factor: number; rowHeight: number; rowGap: number; groupBorder: number; groupPad: number; topStripHeight: number }>>;
export const interfaceMetrics = (value: unknown = "100") => metrics[normalizeInterfaceSize(value)];
export function scaleMetrics<T>(baseline: T, factor: number): T {
  if (typeof baseline === "number") return (baseline * factor) as T;
  if (Array.isArray(baseline)) return baseline.map((v) => scaleMetrics(v, factor)) as T;
  if (baseline && typeof baseline === "object") return Object.fromEntries(Object.entries(baseline).map(([k, v]) => [k, /fontSize|lineHeight|letterSpacing|^glyph$|opacity|duration|delay|scale|response|damping|stiffness|friction|tension|bounciness|Ms$/.test(k) ? v : scaleMetrics(v, factor)])) as T;
  return baseline;
}
export function scaleTextMetrics<T extends { fontSize?: number; lineHeight?: number; letterSpacing?: number }>(resolved: T, factor: number): T {
  return { ...resolved, fontSize: resolved.fontSize === undefined ? undefined : resolved.fontSize * factor, lineHeight: resolved.lineHeight === undefined ? undefined : resolved.lineHeight * factor, letterSpacing: resolved.letterSpacing === undefined ? undefined : resolved.letterSpacing * factor };
}
