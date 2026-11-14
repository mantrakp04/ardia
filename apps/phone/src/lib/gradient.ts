export function linearGradientCss(colors: readonly string[], diagonal: boolean, width: number, height: number): string {
  const stops = colors.length === 1 ? [colors[0]!, colors[0]!] : colors;
  const last = Math.max(1, stops.length - 1);
  const parts = stops.map((color, index) => `${color} ${Math.round((index / last) * 10000) / 100}%`).join(", ");
  if (!diagonal || width <= 0 || height <= 0) return `linear-gradient(180deg, ${parts})`;
  const angle = 180 - (Math.atan2(width, height) * 180) / Math.PI;
  return `linear-gradient(${Math.round(angle * 100) / 100}deg, ${parts})`;
}
