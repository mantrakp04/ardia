import raw from "./computerUse.json";
import { REPO } from "./release";

type RawCell = (typeof raw.cells)[number];
type RawContender = (typeof raw.contenders)[number];
type Side = "ardia" | "aside" | "opencode";

export type Bar = { task: string; value: number; text: string; passes: number; runs: number; partial: boolean };
export type Series = { side: Side; name: string; total: string; bars: (Bar | null)[] };
export type Chart = { id: string; title: string; agent: string; ticks: { value: number; text: string; at: number }[]; max: number; series: Series[] };

const SHORT: Record<string, string> = {
  calendar: "Calendar",
  expenses: "Expenses",
  research: "Research",
  booking: "Booking",
  shop: "Shop",
  grid: "Grid",
  kanban: "Kanban",
  multitab: "Multi-tab",
};
const SIDES: { side: Side; name: string }[] = [
  { side: "ardia", name: "Ardia" },
  { side: "aside", name: "Aside" },
  { side: "opencode", name: "OpenCode" },
];
const MODELS = ["GPT-6.1 Sol", "Opus 5.5"];

const contenders = raw.contenders as RawContender[];
const cells = raw.cells as RawCell[];
const cellOf = (task: string, contender: string) => cells.find((c) => c.task === task && c.contender === contender && c.runs > 0);
const contenderOf = (side: Side, model: string) => contenders.find((c) => c.side === side && c.model === model);
const agentOf = (model: string) => contenders.find((c) => c.side === "ardia" && c.model === model)?.agent ?? "";

const millions = (t: number) => `${(t / 1e6).toFixed(2)}M`;
const tokenTick = (t: number) => (t === 0 ? "0" : t >= 1e6 ? `${+(t / 1e6).toFixed(1)}M` : `${Math.round(t / 1000)}K`);

function niceStep(rough: number) {
  const power = 10 ** Math.floor(Math.log10(rough));
  return [1, 2, 5, 10].map((f) => f * power).find((s) => s >= rough) ?? 10 * power;
}

function chartOf(model: string): Chart {
  const series = SIDES.flatMap(({ side, name }) => {
    const contender = contenderOf(side, model);
    if (!contender) return [];
    const bars = raw.tasks.map((t) => {
      const cell = cellOf(t.id, contender.id);
      const value = cell?.tokens ?? null;
      if (!cell || value == null) return null;
      return {
        task: SHORT[t.id] ?? t.title,
        value,
        text: millions(value),
        passes: cell.passes,
        runs: cell.runs,
        partial: cell.passes < cell.runs,
      };
    });
    const sum = bars.reduce((n, b) => n + (b?.value ?? 0), 0);
    return [{ side, name, total: millions(sum), bars }];
  });
  const top = Math.max(...series.flatMap((s) => s.bars.map((b) => b?.value ?? 0)));
  const step = niceStep(top / 4);
  const max = step * Math.ceil(top / step);
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => {
    const value = step * i;
    return { value, text: tokenTick(value), at: (value / max) * 100 };
  });
  return {
    id: `${model.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-tokens`,
    title: "Tokens",
    agent: `${agentOf(model)} · ${model}`,
    ticks,
    max,
    series,
  };
}

function formatDay(date: string | null) {
  return date
    ? new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    : "";
}

const partialCells = cells.filter((c) => c.passes < c.runs);

export const computerUse = {
  dates: raw.from === raw.to ? formatDay(raw.from) : `${formatDay(raw.from)} to ${formatDay(raw.to)}`,
  asideVersion: raw.asideVersion,
  opencodeVersion: raw.opencodeVersion,
  repeats: raw.repeats,
  planned: raw.planned,
  runs: raw.runs,
  passes: cells.reduce((n, c) => n + c.passes, 0),
  complete: raw.runs >= raw.planned,
  taskCount: raw.tasks.length,
  tasks: raw.tasks.map((t) => SHORT[t.id] ?? t.title),
  sides: SIDES,
  partial: partialCells.map((c) => {
    const k = contenders.find((x) => x.id === c.contender);
    const side = SIDES.find((s) => s.side === k?.side)?.name ?? "";
    return `${side} + ${k?.model} on ${(SHORT[c.task] ?? c.task).toLowerCase()} passed ${c.passes} of ${c.runs}`;
  }),
  charts: MODELS.map(chartOf),
  source: `${REPO}/tree/main/apps/cli/bench`,
};
