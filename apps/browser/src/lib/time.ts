const units = (n: number, unit: string) => (n === 1 ? `1 ${unit} ago` : `${n} ${unit}s ago`);

export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return units(m, "minute");
  const h = Math.floor(m / 60);
  if (h < 24) return units(h, "hour");
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  if (d < 30) return units(Math.floor(d / 7), "week");
  if (d < 365) return units(Math.floor(d / 30), "month");
  return units(Math.floor(d / 365), "year");
}
