import { display, type Bar, type Bench, type Figure, type Row } from "./bench";

export type Outcome = "win" | "loss" | "tie";

export type Verdict = {
  figure: Figure | null;
  line: string;
  note: string | null;
  photoFinish: boolean;
};

export type Lane = { name: string; isArdia: boolean; bar: Bar | null };

export type Case = {
  id: string;
  label: string;
  fullLabel: string;
  outcome: Outcome;
  winner: string;
  lanes: Lane[];
};

export type Card = {
  id: string;
  title: string;
  wide: boolean;
  solo: boolean;
  outcome: Outcome;
  stamp: string;
  context: string | null;
  verdict: Verdict;
  cases: Case[];
  unit: string;
  meta: string;
  caption: string;
  record: { won: number; of: number };
  footnotes: string[];
};


export type Scorecard = {
  cards: Card[];
  total: number;
  losses: number;
  takenBy: { name: string; count: number }[];
  roster: string[];
};

const PHOTO_FINISH_PCT = 5;

const figureText = (f: Figure) => `${display(f)}${f.suffix}`;
const comparativeOf = (line: string) => line.replace(/\s+(than|for)\s+.*$/, "");
const plainCase = (sub: string) => sub.replace(/\s*\(.*$/, "");
const valueText = (bar: Bar) => `${display(bar.value)}${bar.unit === "%" ? "%" : ` ${bar.unit}`}`;

function outcomeOf(row: Row): Outcome {
  const ardia = row.bars.find((b) => b.isArdia);
  if (!ardia?.isBest) return "loss";
  return row.bars.some((b) => !b.isArdia && b.isBest) ? "tie" : "win";
}

function winnerOf(row: Row): string {
  const outcome = outcomeOf(row);
  if (outcome === "win") return row.bars.find((b) => b.isArdia)!.name;
  return row.bars.find((b) => !b.isArdia && b.isBest)!.name;
}

const isPhotoFinish = (f: Figure | null) => !!f && f.suffix === "%" && f.value < PHOTO_FINISH_PCT;

function verdictOf(row: Row): Verdict {
  const { call } = row;
  const outcome = outcomeOf(row);
  if (outcome !== "loss" || call.lost) {
    const note = outcome === "loss" ? null : call.second ? `${figureText(call.second.figure)} ${call.second.line}` : null;
    return { figure: call.figure, line: call.line, note, photoFinish: isPhotoFinish(call.figure) };
  }
  const beaten = call.second;
  const consolation = call.figure ? `Ardia’s still ${figureText(call.figure)} ${call.line}.` : call.line;
  if (!beaten) return { figure: null, line: `Within a hair of ${winnerOf(row)}.`, note: consolation, photoFinish: true };
  return {
    figure: beaten.figure,
    line: `${comparativeOf(beaten.line)} than Ardia`,
    note: consolation,
    photoFinish: isPhotoFinish(beaten.figure),
  };
}

function lanesOf(row: Row, roster: string[]): Lane[] {
  return roster.map((name) => {
    const bar = row.bars.find((b) => b.name === name) ?? null;
    return { name, isArdia: bar?.isArdia ?? roster[0] === name, bar };
  });
}

function stampOf(outcome: Outcome, winner: string): string {
  if (outcome === "tie") return "Dead heat";
  if (outcome === "loss") return `${winner} wins this one`;
  return "Ardia";
}

function cardOf(group: Bench["groups"][number], roster: string[]): Card {
  const cases: Case[] = group.rows.map((row) => ({
    id: row.id,
    label: plainCase(row.sub ?? row.label),
    fullLabel: row.label,
    outcome: outcomeOf(row),
    winner: winnerOf(row),
    lanes: lanesOf(row, roster),
  }));
  const headIndex = Math.max(0, cases.findIndex((c) => c.outcome === "win"));
  const head = group.rows[headIndex];
  const wide = group.rows.length > 1;
  const won = cases.filter((c) => c.outcome === "win").length;
  const outcome = wide ? (won > 0 ? "win" : cases[0].outcome) : cases[0].outcome;
  const footnotes = wide
    ? cases.flatMap((c, i) => {
        if (c.outcome === "win") return [];
        const row = group.rows[i];
        const ardia = row.bars.find((b) => b.isArdia)!;
        const best = row.bars.find((b) => b.name === c.winner)!;
        const verb = c.outcome === "tie" ? "ties" : "takes";
        return [`${c.winner} ${verb} ${c.label.toLowerCase()}: ${valueText(best)} to Ardia’s ${valueText(ardia)}.`];
      })
    : [];
  return {
    id: group.id,
    title: group.label,
    wide,
    solo: false,
    outcome,
    stamp: wide ? `Ardia ${won} of ${cases.length}` : stampOf(cases[0].outcome, cases[0].winner),
    context: wide ? cases[headIndex].label : null,
    verdict: verdictOf(head),
    cases,
    unit: head.bars[0].unit,
    meta: head.meta,
    caption: wide ? `${group.label}, in ${head.bars[0].unit}. ${head.meta}.` : head.caption,
    record: { won, of: cases.length },
    footnotes,
  };
}

export function scorecardOf(bench: Bench): Scorecard {
  const rows = bench.groups.flatMap((g) => g.rows);
  const ardiaName = rows[0].bars.find((b) => b.isArdia)!.name;
  const roster = [ardiaName, ...bench.rivals];
  const outcomes = rows.map((r) => ({ outcome: outcomeOf(r), winner: winnerOf(r) }));
  const takenBy = new Map<string, number>();
  for (const o of outcomes) if (o.outcome === "loss") takenBy.set(o.winner, (takenBy.get(o.winner) ?? 0) + 1);
  const cards = bench.groups.map((g) => cardOf(g, roster));
  const singles = cards.filter((c) => !c.wide);
  if (singles.length % 2 === 1) singles[singles.length - 1].solo = true;
  return {
    cards,
    total: rows.length,
    losses: outcomes.filter((o) => o.outcome === "loss").length,
    takenBy: [...takenBy].map(([name, count]) => ({ name, count })),
    roster,
  };
}
