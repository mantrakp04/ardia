export const RIVALS_MAX_AGE_DAYS = 60;

export class RivalsRefused extends Error {}

const DAY_MS = 86_400_000;
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS);
const majorMinor = (version) => String(version ?? "").split(".").slice(0, 2).join(".");

export function machineMismatch(fresh, stored) {
  if (typeof stored !== "object" || !stored) return ["the stored machine isn't recorded field by field"];
  return ["model", "chip"].filter((k) => fresh?.[k] !== stored[k]).map((k) => `${k}: stored "${stored[k]}", this Mac "${fresh?.[k]}"`);
}

export function refusals(fresh, stored) {
  const reasons = machineMismatch(fresh.machine, stored.machine).map((r) => `different machine (${r})`);
  if (fresh.harness !== stored.harness) reasons.push(`different harness (stored ${stored.harness ?? "unrecorded"}, this one ${fresh.harness})`);
  return reasons;
}

const measuredOf = (stored, key, entry) => entry?.measured ?? stored.browsers?.[key]?.measured ?? stored.date;

function bestOf(row) {
  const ranked = Object.entries(row.browsers)
    .filter(([, b]) => typeof b.median === "number")
    .sort((a, b) => (row.lowerIsBetter ? a[1].median - b[1].median : b[1].median - a[1].median));
  return ranked[0]?.[0] ?? null;
}

export function mergeRivals(fresh, stored, { force = false } = {}) {
  const refused = refusals(fresh, stored);
  if (refused.length && !force) throw new RivalsRefused(`won't merge with the stored rivals: ${refused.join("; ")}. Run every browser again, or pass --force`);
  const own = new Set(Object.keys(fresh.browsers));
  const stamp = (entry, measured) => ({ ...entry, measured });
  const keptRivals = (browsers, entryMeasured) =>
    Object.fromEntries(Object.entries(browsers ?? {}).filter(([k]) => !own.has(k)).map(([k, b]) => [k, stamp(b, entryMeasured(k, b))]));

  const browsers = {
    ...Object.fromEntries(Object.entries(fresh.browsers).map(([k, b]) => [k, stamp(b, fresh.date)])),
    ...keptRivals(stored.browsers, (k, b) => b.measured ?? stored.date),
  };

  const freshRows = new Map(fresh.rows.map((r) => [r.id, r]));
  const storedIds = new Set(stored.rows.map((r) => r.id));
  const merged = stored.rows.map((row) => {
    const now = freshRows.get(row.id);
    if (!now) return { ...row, browsers: Object.fromEntries(Object.entries(row.browsers).map(([k, b]) => [k, stamp(b, measuredOf(stored, k, b))])) };
    return {
      ...row,
      ...now,
      browsers: {
        ...Object.fromEntries(Object.entries(now.browsers).map(([k, b]) => [k, stamp(b, fresh.date)])),
        ...keptRivals(row.browsers, (k, b) => measuredOf(stored, k, b)),
      },
    };
  });
  for (const row of fresh.rows)
    if (!storedIds.has(row.id)) merged.push({ ...row, browsers: Object.fromEntries(Object.entries(row.browsers).map(([k, b]) => [k, stamp(b, fresh.date)])) });
  for (const row of merged) row.best = bestOf(row);

  return {
    ...fresh,
    date: fresh.date,
    browsers,
    rows: merged,
    notes: stored.notes ?? fresh.notes,
    ...(refused.length ? { forced: refused } : {}),
  };
}

export function rivalWarnings(merged, { installed = {}, maxAgeDays = RIVALS_MAX_AGE_DAYS } = {}) {
  const warnings = [];
  for (const [key, b] of Object.entries(merged.browsers)) {
    if (b.measured === merged.date) continue;
    const age = daysBetween(b.measured, merged.date);
    if (age > maxAgeDays) warnings.push(`${b.name} was measured ${age} days ago (${b.measured}), over ${maxAgeDays}: rerun every browser`);
    const now = installed[key];
    if (now && majorMinor(now) !== majorMinor(b.version))
      warnings.push(`${b.name} is now ${now}, measured on ${b.version}: a new ${now.split(".")[0] !== String(b.version).split(".")[0] ? "major" : "minor"} version, rerun every browser`);
  }
  return warnings;
}
