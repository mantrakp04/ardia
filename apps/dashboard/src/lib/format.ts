import type { Step } from "./range";
import { UTC, viewerZone, zoneLabel } from "./zone";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en-US");

export const formatCount = (n: number | null | undefined) => (n == null ? "–" : Math.abs(n) >= 10_000 ? compact.format(n) : whole.format(Math.round(n)));
export const formatExact = (n: number | null | undefined) => (n == null ? "–" : whole.format(n));
export const formatCompact = (n: number) => (Math.abs(n) >= 1000 ? compact.format(n) : whole.format(Math.round(n * 10) / 10));

export const formatPercent = (r: number | null | undefined, digits = 1) =>
  r == null ? "–" : `${(r * 100).toFixed(r * 100 >= 10 || digits === 0 ? (digits === 0 ? 0 : 1) : digits)}%`;

export function formatDelta(value: number | null, previous: number | null, kind: "count" | "percent") {
  if (value == null || previous == null) return null;
  if (kind === "percent") {
    const pts = (value - previous) * 100;
    return { text: `${pts >= 0 ? "+" : "−"}${Math.abs(pts).toFixed(1)} pts`, direction: Math.sign(pts) };
  }
  if (previous === 0) return value === 0 ? { text: "±0", direction: 0 } : { text: "new", direction: 1 };
  const change = (value - previous) / previous;
  const pct = Math.round(change * 100);
  return { text: `${pct > 0 ? "+" : pct < 0 ? "−" : "±"}${Math.abs(pct)}%`, direction: Math.sign(pct) };
}

const formats = new Map<string, Intl.DateTimeFormat>();

function formatIn(zone: string, kind: "day" | "hour" | "full" | "date" | "weekday") {
  const key = `${zone}|${kind}`;
  let fmt = formats.get(key);
  if (!fmt) {
    const options: Record<typeof kind, Intl.DateTimeFormatOptions> = {
      day: { month: "short", day: "numeric" },
      hour: { hour: "numeric" },
      full: { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
      date: { month: "short", day: "numeric", year: "numeric" },
      weekday: { weekday: "short", month: "short", day: "numeric" },
    };
    fmt = new Intl.DateTimeFormat("en-US", { ...options[kind], timeZone: zone });
    formats.set(key, fmt);
  }
  return fmt;
}

export const formatTick = (ms: number, step: Step, zone = UTC) =>
  step === "hour" ? formatIn(zone, "hour").format(ms).toLowerCase().replace(" ", "") : formatIn(zone, "day").format(ms);
export const formatBucket = (ms: number, step: Step, zone = UTC) =>
  step === "hour" ? `${formatIn(zone, "full").format(ms)} ${zoneLabel(zone, ms)}` : formatIn(zone, "weekday").format(ms);
export const formatDateTime = (ms: number, zone = viewerZone()) => `${formatIn(zone, "full").format(ms)} ${zoneLabel(zone, ms)}`;
export const formatDate = (ms: number | string, zone = viewerZone()) => formatIn(zone, "date").format(typeof ms === "string" ? Date.parse(ms) : ms);

export function formatAgo(ms: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export const formatMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)} s` : `${Math.round(ms)} ms`);
