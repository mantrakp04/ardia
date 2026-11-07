import raw from "./computerUse.json";

type RawRun = (typeof raw.models)[number]["runs"][number];
type RawModel = { id: string; model: string; versus?: { ardia: string; aside: string; cold: string }; runs: RawRun[] };

export type Measure = { share: number; text: string };
export type Lane = {
  id: string;
  agent: string;
  mode: string;
  isArdia: boolean;
  isPick: boolean;
  runs: number;
  time: Measure;
  tokens: Measure;
};
export type Matchup = {
  id: string;
  model: string;
  faster: string;
  fewer: string;
  rival: string;
  cold: { faster: string; fewer: string };
  lanes: Lane[];
};
export type FreshRun = { agent: string; model: string; result: string; time: string; tokens: string };
export type Extra = { agent: string; model: string; mode: string; runs: number; time: string; tokens: string };

const floorTo = (v: number, places: number) => Math.floor(v * 10 ** places + 1e-9) / 10 ** places;
const speedup = (fast: number, slow: number) => `${floorTo(slow / fast, slow / fast >= 1.5 ? 1 : 2)}×`;
const saving = (less: number, more: number) => `${Math.round((1 - less / more) * 100)}%`;
const seconds = (s: number) => `${s.toFixed(1)} s`;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const tokens = (t: number) => (t >= 1e6 ? `${(t / 1e6).toFixed(2)}M` : `${Math.round(t / 1000)}K`);

const models = raw.models as RawModel[];
const compared = models.filter((m): m is Required<RawModel> => !!m.versus);
const allRuns = compared.flatMap((m) => m.runs);
const slowest = Math.max(...allRuns.map((r) => r.seconds));
const hungriest = Math.max(...allRuns.map((r) => r.tokens));

function matchupOf(m: Required<RawModel>): Matchup {
  const find = (id: string) => m.runs.find((r) => r.id === id)!;
  const ardia = find(m.versus.ardia);
  const aside = find(m.versus.aside);
  const cold = find(m.versus.cold);
  return {
    id: m.id,
    model: m.model,
    faster: speedup(ardia.seconds, aside.seconds),
    fewer: saving(ardia.tokens, aside.tokens),
    rival: aside.mode.toLowerCase(),
    cold: { faster: speedup(cold.seconds, aside.seconds), fewer: saving(cold.tokens, aside.tokens) },
    lanes: m.runs.map((r) => ({
      id: r.id,
      agent: r.agent,
      mode: r.mode,
      isArdia: r.ardia,
      isPick: r.id === ardia.id || r.id === aside.id,
      runs: r.runs,
      time: { share: r.seconds / slowest, text: seconds(r.seconds) },
      tokens: { share: r.tokens / hungriest, text: tokens(r.tokens) },
    })),
  };
}

function formatDay(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export const computerUse = {
  dates: `${formatDay(raw.from)} to ${formatDay(raw.to)}, ${raw.to.slice(0, 4)}`,
  task: raw.task,
  matchups: compared.map(matchupOf),
  extras: models
    .filter((m) => !m.versus)
    .flatMap((m) =>
      m.runs.map(
        (r): Extra => ({ agent: r.agent, model: m.model, mode: r.mode.toLowerCase(), runs: r.runs, time: seconds(r.seconds), tokens: tokens(r.tokens) }),
      ),
    ),
  fresh: {
    title: raw.fresh.title,
    traps: raw.fresh.traps,
    runs: raw.fresh.runs.map(
      (r): FreshRun => ({ agent: r.agent, model: r.model, result: `${r.passed}/${r.of}`, time: clock(r.seconds), tokens: tokens(r.tokens) }),
    ),
  },
};
