const HOUR = 3_600_000;
const DAY = 86_400_000;

export const UTC = "UTC";

export function viewerZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || UTC;
  } catch {
    return UTC;
  }
}

export function parseZone(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(value)) return UTC;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return UTC;
  }
}

const partsFormats = new Map<string, Intl.DateTimeFormat>();

function partsFormat(zone: string) {
  let fmt = partsFormats.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    partsFormats.set(zone, fmt);
  }
  return fmt;
}

export function zoneOffsetMs(ms: number, zone: string): number {
  if (zone === UTC) return 0;
  const p: Record<string, number> = {};
  for (const part of partsFormat(zone).formatToParts(ms)) if (part.type !== "literal") p[part.type] = Number(part.value);
  const wall = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!);
  return wall - Math.floor(ms / 1000) * 1000;
}

function floorInZone(ms: number, size: number, zone: string): number {
  const wall = Math.floor((ms + zoneOffsetMs(ms, zone)) / size) * size;
  const guess = wall - zoneOffsetMs(ms, zone);
  return wall - zoneOffsetMs(guess, zone);
}

export const startOfHour = (ms: number, zone: string) => floorInZone(ms, HOUR, zone);
export const startOfDay = (ms: number, zone: string) => floorInZone(ms, DAY, zone);
export const addDays = (dayStart: number, days: number, zone: string) => startOfDay(dayStart + days * DAY + 12 * HOUR, zone);

export function zoneLabel(zone: string, at = Date.now()): string {
  if (zone === UTC) return UTC;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? zone;
  } catch {
    return zone;
  }
}
