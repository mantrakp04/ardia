import raw from "./computerUse.json";
import { REPO } from "./release";

type RawCell = (typeof raw.cells)[number];
type RawContender = (typeof raw.contenders)[number];

export type Mark = "pass" | "fail" | "mixed";
export type Entry = {
  contender: string;
  pair: string;
  isArdia: boolean;
  runs: number;
  passes: number;
  mark: Mark | null;
  result: string;
  time: string | null;
  tokens: string | null;
  won: boolean;
};
export type TaskRow = { id: string; name: string; sub: string | null; note: string | null; entries: Entry[] };
export type Ratio = { ardiaWins: boolean; even: boolean; figure: string };
export type Pairing = {
  id: string;
  model: string;
  ardia: { id: string; name: string; passes: number; runs: number };
  aside: { id: string; name: string; passes: number; runs: number };
  compared: number;
  faster: number;
  speed: Ratio | null;
  tokens: Ratio | null;
};

const SHORT: Record<string, string> = {
  calendar: "Calendar",
  expenses: "Expense report",
  research: "Docs research",
  booking: "Flight booking",
  shop: "Shop checkout",
  grid: "Inventory grid",
  kanban: "Sprint board",
  multitab: "Kickoff, 3 tabs",
};
const SUB: Record<string, string> = {
  calendar: "Five events",
  expenses: "From receipts in a 200-email inbox",
  research: "Vendor review from versioned docs",
  booking: "Two seats together",
  shop: "Cheapest docks, with a promo code",
  grid: "Reorder levels and a new row",
  kanban: "Moves, labels, archive",
  multitab: "Inbox, directory and calendar",
};
const NOTES: Record<string, string> = {
  research: "Shell agents can read the docs with curl; Aside’s agent can’t.",
};

const contenders = raw.contenders as RawContender[];
const cells = raw.cells as RawCell[];
const cellOf = (task: string, contender: string) => cells.find((c) => c.task === task && c.contender === contender && c.runs > 0);
const nameOf = (c: RawContender) => (c.side === "ardia" ? `Ardia + ${c.agent}` : c.agent);

const pairs = contenders
  .filter((c) => c.side === "ardia")
  .flatMap((ardia) => {
    const aside = contenders.find((c) => c.side === "aside" && c.model === ardia.model);
    return aside ? [{ id: ardia.model.toLowerCase().replace(/[^a-z0-9]+/g, "-"), model: ardia.model, ardia, aside }] : [];
  });

const seconds = (s: number) => `${s.toFixed(1)} s`;
const tokenText = (t: number) => (t >= 1e6 ? `${(t / 1e6).toFixed(2)}M` : `${Math.round(t / 1000)}K`);
const passRate = (c: RawCell) => c.passes / c.runs;

function markOf(c: RawCell): Mark {
  return c.passes === c.runs ? "pass" : c.passes === 0 ? "fail" : "mixed";
}

function beats(a: RawCell | undefined, b: RawCell | undefined): boolean {
  if (!a || a.time == null) return false;
  if (!b || b.time == null) return false;
  if (passRate(a) !== passRate(b)) return passRate(a) > passRate(b);
  return a.time < b.time;
}

function geomean(ratios: number[]): number | null {
  const ok = ratios.filter((r) => Number.isFinite(r) && r > 0);
  return ok.length ? Math.exp(ok.reduce((s, r) => s + Math.log(r), 0) / ok.length) : null;
}

function ratioOf(g: number | null, kind: "speed" | "tokens"): Ratio | null {
  if (g == null) return null;
  const ardiaWins = g >= 1;
  const r = ardiaWins ? g : 1 / g;
  if (r >= 1.5) {
    const value = Math.floor(r * 10 + 1e-9) / 10;
    return { ardiaWins, even: false, figure: `${value}×` };
  }
  const pct = Math.floor((kind === "speed" ? r - 1 : 1 - 1 / r) * 100 + 1e-9);
  if (pct < 1) return { ardiaWins, even: true, figure: "Even" };
  return { ardiaWins, even: false, figure: `${pct}%` };
}

function pairingOf(p: (typeof pairs)[number]): Pairing {
  const tally = (id: string) =>
    cells.filter((c) => c.contender === id).reduce((t, c) => ({ passes: t.passes + c.passes, runs: t.runs + c.runs }), { passes: 0, runs: 0 });
  const both = raw.tasks.flatMap((t) => {
    const a = cellOf(t.id, p.ardia.id);
    const b = cellOf(t.id, p.aside.id);
    return a && b ? [{ a, b }] : [];
  });
  const timed = both.filter(({ a, b }) => a.time != null && b.time != null);
  const tokened = both.filter(({ a, b }) => a.tokens != null && b.tokens != null);
  return {
    id: p.id,
    model: p.model,
    ardia: { id: p.ardia.id, name: nameOf(p.ardia), ...tally(p.ardia.id) },
    aside: { id: p.aside.id, name: nameOf(p.aside), ...tally(p.aside.id) },
    compared: timed.length,
    faster: timed.filter(({ a, b }) => a.time! < b.time!).length,
    speed: ratioOf(geomean(timed.map(({ a, b }) => b.time! / a.time!)), "speed"),
    tokens: ratioOf(geomean(tokened.map(({ a, b }) => b.tokens! / a.tokens!)), "tokens"),
  };
}

function rowOf(task: { id: string; title: string }): TaskRow {
  const [head, tail] = task.title.split(/:\s+/, 2);
  return {
    id: task.id,
    name: SHORT[task.id] ?? head,
    sub: SUB[task.id] ?? tail ?? null,
    note: NOTES[task.id] ?? null,
    entries: pairs.flatMap((p) =>
      [p.ardia, p.aside].map((c) => {
        const cell = cellOf(task.id, c.id);
        const rival = cellOf(task.id, c === p.ardia ? p.aside.id : p.ardia.id);
        return {
          contender: c.id,
          pair: p.id,
          isArdia: c.side === "ardia",
          runs: cell?.runs ?? 0,
          passes: cell?.passes ?? 0,
          mark: cell ? markOf(cell) : null,
          result: cell ? `${cell.passes}/${cell.runs}` : "–",
          time: cell?.time != null ? seconds(cell.time) : null,
          tokens: cell?.tokens != null ? tokenText(cell.tokens) : null,
          won: beats(cell, rival),
        };
      }),
    ),
  };
}

function formatDay(date: string | null) {
  return date
    ? new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    : "";
}

const asideCells = cells.filter((c) => contenders.find((k) => k.id === c.contender)?.side === "aside");

export const computerUse = {
  dates: raw.from === raw.to ? formatDay(raw.from) : `${formatDay(raw.from)} to ${formatDay(raw.to)}`,
  asideVersion: raw.asideVersion,
  repeats: raw.repeats,
  planned: raw.planned,
  runs: raw.runs,
  complete: raw.runs >= raw.planned,
  taskCount: raw.tasks.length,
  contenderCount: contenders.length,
  asideRuns: asideCells.reduce((n, c) => n + c.runs, 0),
  asideFront: asideCells.reduce((n, c) => n + c.frontmost, 0),
  pairings: pairs.map(pairingOf),
  columns: pairs.flatMap((p) => [p.ardia, p.aside].map((c) => ({ id: c.id, pair: p.id, name: nameOf(c), isArdia: c.side === "ardia" }))),
  rows: raw.tasks.map(rowOf),
  source: `${REPO}/tree/main/apps/cli/bench`,
};

export const showComputerUse: boolean = import.meta.env.DEV || import.meta.env.COMPUTER_USE_PUBLISHED;
