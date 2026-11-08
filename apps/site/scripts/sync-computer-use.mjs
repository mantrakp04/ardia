#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const usage = `Usage: node apps/site/scripts/sync-computer-use.mjs [RESULTS_DIR] [--aside-version V]

Copies the browser-agent bench summary (apps/cli/bench) into apps/site/src/data/computerUse.json,
keeping only what the Computer use section needs. Rerun it whenever the bench writes a new summary.

RESULTS_DIR       a plan's results folder with summary.json and runs/ (default ~/ardia-scratch/bench-proper/results/full-1)
--aside-version   the Aside version the bench ran against (default 1.26.1107)`;

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  console.log(usage);
  process.exit(0);
}
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args.splice(i, 2)[1] : fallback;
};
const asideVersion = flag("--aside-version", "1.26.1107");
const resultsDir = resolve((args[0] ?? "~/ardia-scratch/bench-proper/results/full-1").replace(/^~(?=\/|$)/, homedir()));
const out = fileURLToPath(new URL("../src/data/computerUse.json", import.meta.url));

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const summary = readJson(join(resultsDir, "summary.json"));
if (summary.schema !== 1) throw new Error(`unknown summary schema ${summary.schema}`);

const shownSides = new Set(["ardia", "aside"]);
const shown = summary.contenders.filter((c) => shownSides.has(c.side));
const shownIds = new Set(shown.map((c) => c.id));

const runFiles = readdirSync(join(resultsDir, "runs")).filter((f) => /--r\d+\.json$/.test(f));
const runs = runFiles.map((f) => readJson(join(resultsDir, "runs", f))).filter((r) => r && !r.harness_error && shownIds.has(r.contender));
const localDay = (iso) => new Date(iso).toLocaleDateString("en-CA");
const days = runs.map((r) => r.started_at).filter(Boolean).map(localDay).sort();

const agentName = (c) => (c.side === "aside" ? "Aside" : c.agent === "claude" ? "Claude Code" : c.agent === "codex" ? "Codex" : c.agent);
const modelName = (c) => c.label?.match(/\(([^)]+)\)\s*$/)?.[1] ?? c.model;
const round = (v, places) => (typeof v === "number" ? Number(v.toFixed(places)) : null);

const cells = summary.cells.filter((c) => shownIds.has(c.contender)).map((c) => ({
  task: c.task,
  contender: c.contender,
  runs: c.runs,
  passes: c.passes,
  time: round(c.median_time_s, 1),
  tokens: typeof c.median_tokens === "number" ? Math.round(c.median_tokens) : null,
  frontmost: (c.frontmost_during_run ?? []).filter((n) => n > 0).length,
}));

const data = {
  plan: summary.plan,
  generated: summary.generated_at,
  from: days[0] ?? null,
  to: days.at(-1) ?? null,
  asideVersion,
  repeats: summary.repeats,
  planned: summary.tasks.length * shown.length * (summary.repeats ?? 1),
  runs: cells.reduce((n, c) => n + c.runs, 0),
  tasks: summary.tasks.map((t) => ({ id: t.id, title: t.title })),
  contenders: shown.map((c) => ({ id: c.id, side: c.side, agent: agentName(c), model: modelName(c) })),
  cells,
};

writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`);
console.log(`wrote ${out}: ${data.runs} of ${data.planned} runs, ${data.from} to ${data.to}`);
