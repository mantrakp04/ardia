type RGB = [number, number, number];
type RGBA = [number, number, number, number];
export type IconBackground = string | readonly string[];

const clamp = (value: number, maximum: number) => Math.max(0, Math.min(maximum, value));
const rgb = (color: string): RGB => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)) as RGB;
const hex = (color: RGB) => `#${color.map((v) => Math.round(clamp(v, 255)).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
const luminance = (color: RGB) => color.reduce((sum, value, i) => {
  const channel = value / 255;
  return sum + (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]!;
}, 0);
const contrast = (first: number, second: number) => (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);

function rgba(color: string): RGBA | null {
  if (color === "transparent") return [0, 0, 0, 0];
  if (/^#[\da-f]{6}([\da-f]{2})?$/i.test(color)) return [...rgb(color), color.length === 9 ? parseInt(color.slice(7, 9), 16) / 255 : 1];
  const match = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (!match) return null;
  const values = match.slice(1, 4).map(Number);
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  if (![...values, alpha].every(Number.isFinite)) return null;
  return [clamp(values[0]!, 255), clamp(values[1]!, 255), clamp(values[2]!, 255), clamp(alpha, 1)];
}

export function iconSurfaces(background: IconBackground, ...overlayLayers: (string | null | undefined)[]): string[] {
  const backgrounds = typeof background === "string" ? [background] : background;
  const overlays = overlayLayers.map((layer) => layer ? rgba(layer) : null).filter((layer): layer is RGBA => layer !== null);
  const surfaces = backgrounds.map(rgba).filter((color): color is RGBA => color !== null).map((base) => {
    let result = base.slice(0, 3).map((channel) => channel * base[3]! + 255 * (1 - base[3]!)) as RGB;
    for (const [r, g, b, alpha] of overlays) result = [r, g, b].map((channel, i) => channel * alpha + result[i]! * (1 - alpha)) as RGB;
    return hex(result);
  });
  return [...new Set(surfaces)];
}

export function iconContrast(first: string, second: string): number {
  return contrast(luminance(rgb(first)), luminance(rgb(second)));
}

export function duotoneColors(palette: readonly string[], background: IconBackground, dark: boolean): { foreground: string; fill: string } {
  const colors = palette.map(rgba).filter((color): color is RGBA => color !== null).map((color) => hex(color.slice(0, 3) as RGB));
  const primary = colors[0] ?? (dark ? "#FFFFFF" : "#333333");
  const fill = colors[1] ?? primary;
  const surfaces = iconSurfaces(background);
  if (!surfaces.length) surfaces.push(dark ? "#2A2A2A" : "#FFFFFF");
  const surfaceColors = surfaces.map(rgb);
  const surfaceLuminance = surfaceColors.map(luminance);
  for (let index = 0; index < surfaceColors.length - 1; index++) {
    const first = surfaceColors[index]!;
    const second = surfaceColors[index + 1]!;
    const at = (amount: number) => luminance(first.map((channel, i) => channel + (second[i]! - channel) * amount) as RGB);
    let low = 0, high = 1;
    for (let step = 0; step < 24; step++) {
      const left = low + (high - low) / 3, right = high - (high - low) / 3;
      if (at(left) < at(right)) high = right;
      else low = left;
    }
    surfaceLuminance.push(at((low + high) / 2));
  }
  const darkest = Math.min(...surfaceLuminance);
  const lightest = Math.max(...surfaceLuminance);
  const anchor = rgb(primary);
  let foreground = primary;
  let bestContrast = 0;
  for (let step = 0; step <= 20; step++) {
    for (const target of [0, 255]) {
      const candidate = hex(anchor.map((channel) => channel + (target - channel) * step / 20) as RGB);
      const candidateLuminance = luminance(rgb(candidate));
      const minimum = candidateLuminance >= darkest && candidateLuminance <= lightest ? 1 : Math.min(contrast(candidateLuminance, darkest), contrast(candidateLuminance, lightest));
      if (minimum >= 3) return { foreground: candidate, fill };
      if (minimum > bestContrast) {
        foreground = candidate;
        bestContrast = minimum;
      }
    }
  }
  return { foreground, fill };
}
