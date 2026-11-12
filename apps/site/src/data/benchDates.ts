export type DatedBrowser = { name: string; version?: string | null; measured: string };

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
const valid = (iso: string) => !Number.isNaN(at(iso).getTime());

export function dayOf(iso: string, withYear = true): string {
  if (!valid(iso)) return iso;
  return at(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

const listed = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");

const label = (b: DatedBrowser) => `${b.name} ${b.version ?? ""}`.trim();

export function measuredLine(browsers: DatedBrowser[]): string | null {
  const byDate = new Map<string, DatedBrowser[]>();
  for (const b of browsers) byDate.set(b.measured, [...(byDate.get(b.measured) ?? []), b]);
  if (byDate.size < 2) return null;
  const dates = [...byDate.keys()].sort().reverse();
  const oneYear = new Set(dates.map((d) => d.slice(0, 4))).size === 1;
  return dates
    .map((d, i) => `${listed(byDate.get(d)!.map(label))} measured ${dayOf(d, !oneYear || i === dates.length - 1)}`)
    .join(" · ");
}

export function olderThanHeadline(entries: DatedBrowser[], headline: Map<string, string>): string | null {
  const older = entries.filter((b) => {
    const own = headline.get(b.name);
    return own !== undefined && b.measured < own;
  });
  if (!older.length) return null;
  return older.map((b) => `${label(b)} from ${dayOf(b.measured, false)}`).join(", ");
}
