import { REPO } from "./release";
type RawBrowser = {
  name: string;
  version?: string | null;
  chromium?: string | number | null;
  median: number | null;
  min?: number | null;
  max?: number | null;
  n?: number | null;
};
type RawRow = {
  id: string;
  label: string;
  unit: string;
  lowerIsBetter: boolean;
  group?: string;
  browsers: RawBrowser[] | Record<string, RawBrowser>;
};
type MeasuredBrowser = Omit<RawBrowser, "median"> & { median: number };
type Measured = Omit<RawRow, "browsers"> & { browsers: RawBrowser[]; measured: MeasuredBrowser[] };
type RawMachine = { model?: string; chip?: string; cores?: number | string; ram?: string | number; macOS?: string };
type RawBench = { date: string; machine: string | RawMachine; method?: string; rows: RawRow[] };

const SHOWN = /^(ardia|dia|helium)\b/i;

export type Figure = { value: number; decimals: number; from: number; suffix: string };
export type Bar = {
  name: string;
  isArdia: boolean;
  isBest: boolean;
  share: number;
  value: Figure;
  unit: string;
  range: string | null;
  n: number | null;
};
export type Call = {
  lost: boolean;
  kicker: string;
  figure: Figure | null;
  line: string;
  second: { figure: Figure; line: string } | null;
};
export type Row = {
  id: string;
  label: string;
  sub: string | null;
  caption: string;
  meta: string;
  call: Call;
  bars: Bar[];
  lead: number;
};
export type Group = { id: string; label: string; rows: Row[] };
export type Bench = {
  sample: boolean;
  groups: Group[];
  date: string;
  measured: string;
  machine: string;
  versions: string;
  rivals: string[];
};

const real = import.meta.glob<RawBench>("./bench.json", { eager: true, import: "default" })["./bench.json"];
const sample = import.meta.env.DEV
  ? import.meta.glob<RawBench>("./bench.sample.json", { eager: true, import: "default" })["./bench.sample.json"]
  : undefined;

const isArdia = (name: string) => /^ardia\b/i.test(name.trim());
const decimalsFor = (v: number) => (Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 1 ? 1 : 2);
const number = (v: number, decimals: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const withUnit = (text: string, unit: string) => (unit === "%" ? `${text}%` : `${text} ${unit}`);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Kind = { word: string; speed: boolean };
function kindOf(row: Measured): Kind {
  const text = `${row.id} ${row.label} ${row.unit}`.toLowerCase();
  if (!row.lowerIsBetter) return { word: /speedometer/.test(text) ? "faster" : "higher", speed: true };
  if (/power|energy/.test(text) || /^m?w$/i.test(row.unit)) return { word: "less power", speed: false };
  if (/wake/.test(text)) return { word: "fewer wakeups", speed: false };
  if (/cpu/.test(text) || row.unit === "%") return { word: "less CPU", speed: false };
  if (/download|size|dmg|disk/.test(text)) return { word: "smaller download", speed: false };
  if (/mem|ram|rss|footprint/.test(text) || /^[kmg]i?b$/i.test(row.unit)) return { word: "less memory", speed: false };
  if (/^(ms|s|sec|µs|us)$/i.test(row.unit) || /launch|paint|tab|window|switch|time/.test(text))
    return { word: "faster", speed: true };
  return { word: "lower", speed: false };
}

function margin(better: number, worse: number, row: Measured, kind: Kind): Figure | null {
  if (better <= 0 || worse <= 0) return null;
  const ratio = row.lowerIsBetter ? worse / better : better / worse;
  if (!(ratio > 1)) return null;
  if (ratio >= 10) return { value: Math.floor(ratio + 1e-9), decimals: 0, from: 1, suffix: "×" };
  if (ratio >= 1.5) {
    const value = Math.floor(ratio * 10 + 1e-9) / 10;
    return { value, decimals: Number.isInteger(value) ? 0 : 1, from: 1, suffix: "×" };
  }
  const pct = Math.floor((kind.speed ? ratio - 1 : 1 - 1 / ratio) * 100 + 1e-9);
  return pct >= 1 ? { value: pct, decimals: 0, from: 0, suffix: "%" } : null;
}

const isBetter = (a: number, b: number, lower: boolean) => (lower ? a < b : a > b);

function leadOverDia(row: Measured, entries: MeasuredBrowser[]): number {
  const ardia = entries.find((b) => isArdia(b.name))!.median;
  const rival = (entries.find((b) => /^dia\b/i.test(b.name.trim())) ?? entries.find((b) => !isArdia(b.name)))!.median;
  if (ardia <= 0 || rival <= 0) return 0;
  return Math.log(row.lowerIsBetter ? rival / ardia : ardia / rival);
}

function callFor(row: Measured, entries: MeasuredBrowser[], kind: Kind): Call {
  const value = (b: MeasuredBrowser) => b.median;
  const ardia = entries.find((b) => isArdia(b.name))!;
  const others = entries.filter((b) => b !== ardia);
  const ranked = [...others].sort((x, y) => (row.lowerIsBetter ? value(x) - value(y) : value(y) - value(x)));
  const closest = ranked[0];
  const farthest = ranked[ranked.length - 1];
  const dia = others.find((b) => /^dia\b/i.test(b.name.trim()));
  const headline = dia && isBetter(value(ardia), value(dia), row.lowerIsBetter) ? dia : null;

  if (headline) {
    const lead = margin(value(ardia), value(headline), row, kind);
    const rest = ranked.filter((b) => b !== headline);
    const beaten = rest.find((b) => isBetter(value(b), value(ardia), row.lowerIsBetter));
    const kicker = beaten ? `${row.label} · ${beaten.name} wins this one` : row.label;
    const near = rest[0];
    const second = !near
      ? null
      : beaten
        ? (() => {
            const f = margin(value(beaten), value(ardia), row, kind);
            return f ? { figure: f, line: `${kind.word} for ${beaten.name}` } : null;
          })()
        : (() => {
            const f = margin(value(ardia), value(near), row, kind);
            return f ? { figure: f, line: `${kind.word} than ${near.name}` } : null;
          })();
    if (!lead) return { lost: false, kicker, figure: null, line: `Dead even with ${headline.name}.`, second };
    return { lost: false, kicker, figure: lead, line: `${kind.word} than ${headline.name}`, second };
  }

  if (isBetter(value(closest), value(ardia), row.lowerIsBetter)) {
    const figure = margin(value(closest), value(ardia), row, kind);
    if (!figure)
      return { lost: true, kicker: row.label, figure: null, line: `Within a hair of ${closest.name}.`, second: null };
    return { lost: true, kicker: `${row.label} · ${closest.name} wins this one`, figure, line: `${kind.word} than Ardia`, second: null };
  }

  const lead = margin(value(ardia), value(farthest), row, kind);
  if (!lead) return { lost: false, kicker: row.label, figure: null, line: `Dead even with ${farthest.name}.`, second: null };
  const near = closest !== farthest ? margin(value(ardia), value(closest), row, kind) : null;
  return {
    lost: false,
    kicker: row.label,
    figure: lead,
    line: `${kind.word} than ${farthest.name}`,
    second: near ? { figure: near, line: `${kind.word} than ${closest.name}` } : null,
  };
}

function shapeRow(row: Measured): Omit<Row, "sub"> | null {
  const entries = row.measured;
  if (entries.length < 2 || !entries.some((b) => isArdia(b.name))) return null;
  const kind = kindOf(row);
  const sorted = [...entries].sort((x, y) =>
    row.lowerIsBetter ? x.median - y.median : y.median - x.median,
  );
  const best = sorted[0].median;
  const top = Math.max(...entries.map((b) => b.median)) || 1;
  const ns = entries.map((b) => b.n ?? 0).filter((n) => n > 0);
  const n = ns.length ? Math.min(...ns) : 0;
  const direction = row.lowerIsBetter ? "Lower is better" : "Higher is better";
  const runs = n > 1 ? `Median of ${n === Math.max(...ns) ? n : `${n}+`} runs` : null;
  const bars: Bar[] = sorted.map((b) => {
    const v = b.median;
    const decimals = decimalsFor(v);
    const range =
      typeof b.min === "number" && typeof b.max === "number" && b.max > b.min
        ? `${withUnit(number(b.min, decimalsFor(b.min)), row.unit)} to ${withUnit(number(b.max, decimalsFor(b.max)), row.unit)}`
        : null;
    return {
      name: b.name,
      isArdia: isArdia(b.name),
      isBest: v === best,
      share: v / top,
      value: { value: v, decimals, from: 0, suffix: "" },
      unit: row.unit,
      range,
      n: b.n ?? null,
    };
  });
  return {
    id: slug(row.id),
    label: row.label,
    caption: [row.label, `in ${row.unit}`, runs?.toLowerCase(), direction.toLowerCase()].filter(Boolean).join(", "),
    meta: [runs, direction].filter(Boolean).join(" · "),
    call: callFor(row, entries, kind),
    bars,
    lead: leadOverDia(row, entries),
  };
}

function groupRows(rows: Measured[]): Group[] {
  const groups = new Map<string, { label: string; rows: Row[]; power: boolean }>();
  const keyed = rows.flatMap((raw) => {
    const row = shapeRow(raw);
    if (!row) return [];
    const split = raw.label.match(/^(.+?)(,\s+|\s+\(|\s+·\s+)(.+)$/);
    const splitSub = split ? (split[2].trim() === "(" ? split[3].replace(/\)$/, "") : split[3]) : null;
    const key = raw.group ?? (split ? split[1] : raw.label);
    const sub = raw.group ? raw.label : splitSub;
    return [{ key, sub, row, power: kindOf(raw).word === "less power" }];
  });
  const keys = new Set(keyed.map((k) => k.key));
  for (const k of keyed) {
    const parent = [...keys].find((p) => p !== k.key && k.key.startsWith(`${p} `));
    const key = parent ?? k.key;
    const sub = parent ? k.key.slice(parent.length + 1) : k.sub;
    if (!groups.has(key)) groups.set(key, { label: key, rows: [], power: k.power });
    groups.get(key)!.rows.push({ ...k.row, sub: sub ? capitalize(sub) : null });
  }
  const byLead = (a: { lead: number }, b: { lead: number }) => b.lead - a.lead;
  return [...groups.values()]
    .map((g) => {
      const rows = [...g.rows].sort(byLead);
      return {
        id: slug(g.label),
        label: g.label,
        rows: rows.length === 1 ? [{ ...rows[0], sub: null }] : rows,
        lead: rows[0].lead,
        power: g.power,
      };
    })
    .sort((a, b) => Number(a.power) - Number(b.power) || byLead(a, b))
    .map(({ lead: _lead, power: _power, ...g }) => g);
}

function versionsOf(rows: Measured[]): string {
  const seen = new Map<string, string>();
  for (const row of rows)
    for (const b of row.browsers) {
      if (seen.has(b.name)) continue;
      const engine = b.chromium && !/chrome/i.test(b.name) ? ` (Chromium ${b.chromium})` : "";
      seen.set(b.name, `${b.name} ${b.version ?? ""}`.trim() + engine);
    }
  return [...seen.values()].join(", ");
}

function formatDate(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function machineOf(machine: string | RawMachine): string {
  if (typeof machine === "string") return machine;
  const ram = typeof machine.ram === "number" ? `${machine.ram} GB` : machine.ram;
  return [machine.model, machine.chip, ram, machine.macOS && `macOS ${machine.macOS}`].filter(Boolean).join(", ");
}

const hasMedian = (b: RawBrowser): b is MeasuredBrowser => typeof b.median === "number" && Number.isFinite(b.median) && b.median >= 0;

function measure(row: RawRow): Measured {
  const browsers = (Array.isArray(row.browsers) ? row.browsers : Object.values(row.browsers)).filter((b) => SHOWN.test(b.name.trim()));
  return { ...row, browsers, measured: browsers.filter(hasMedian) };
}

function build(source: RawBench | undefined, isSample: boolean): Bench | null {
  if (!source?.rows?.length) return null;
  const raw = { ...source, machine: machineOf(source.machine), rows: source.rows.map(measure) };
  const groups = groupRows(raw.rows);
  if (!groups.length) return null;
  return {
    sample: isSample,
    groups,
    date: formatDate(raw.date),
    measured: raw.date,
    machine: raw.machine,
    versions: versionsOf(raw.rows),
    rivals: [...new Set(raw.rows.flatMap((r) => r.browsers.map((b) => b.name)))].filter((n) => !isArdia(n)),
  };
}

export const bench: Bench | null = real ? build(real, false) : build(sample, true);
export const display = (f: Figure) => number(f.value, f.decimals);
export const BENCH_METHOD = `${REPO}/blob/main/docs/perf/vs-browsers.md`;
