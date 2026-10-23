type RGB = [number, number, number];

const rgb = (color: string): RGB => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)) as RGB;
const hex = (color: RGB) => `#${color.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
const opaque = (color: string) => /^#[\da-f]{6}([\da-f]{2})?$/i.test(color) ? color.slice(0, 7) : null;
const luminance = (color: RGB) => color.reduce((sum, value, i) => {
  const channel = value / 255;
  return sum + (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]!;
}, 0);

export function iconContrast(first: string, second: string): number {
  const [a, b] = [luminance(rgb(first)), luminance(rgb(second))].sort((x, y) => y - x);
  return (a! + 0.05) / (b! + 0.05);
}

export function duotoneColors(palette: readonly string[], background: string, dark: boolean): { foreground: string; fill: string } {
  const colors = palette.map(opaque).filter((color): color is string => color !== null);
  const primary = colors[0] ?? (dark ? "#FFFFFF" : "#333333");
  const fill = colors[1] ?? primary;
  const surface = opaque(background) ?? (dark ? "#2A2A2A" : "#FFFFFF");
  const anchor = rgb(primary);
  const target = luminance(rgb(surface)) > 0.18 ? 0 : 255;
  for (let step = 0; step <= 20; step++) {
    const candidate = hex(anchor.map((channel) => channel + (target - channel) * step / 20) as RGB);
    if (iconContrast(candidate, surface) >= 3) return { foreground: candidate, fill };
  }
  return { foreground: target === 0 ? "#000000" : "#FFFFFF", fill };
}
