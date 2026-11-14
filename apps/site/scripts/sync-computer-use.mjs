#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const usage = `Usage: node apps/site/scripts/sync-computer-use.mjs [RESULTS_DIR ...] [--aside-version V] [--opencode-version V]

Copies the browser-agent bench summaries (apps/cli/bench) into apps/site/src/data/computerUse.json,
keeping only what the Computer use section needs. Rerun it whenever the bench writes a new summary.

RESULTS_DIR         one or more plans' results folders with summary.json and runs/. A contender comes from the
                    first folder that ran it, so list the newest Ardia run first. Default:
                    ~/ardia-scratch/bench-proper/results/{full-3,full-1,opencode-1}
--aside-version     the Aside version the bench ran against (default 1.26.1107)
--opencode-version  the OpenCode Browse extension version (default 0.0.10)`;

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
const opencodeVersion = flag("--opencode-version", "0.0.10");
const defaults = ["full-3", "full-1", "opencode-1"].map((d) => `~/ardia-scratch/bench-proper/results/${d}`);
const resultsDirs = (args.length ? args : defaults).map((d) => resolve(d.replace(/^~(?=\/|$)/, homedir())));
const out = fileURLToPath(new URL("../src/data/computerUse.json", import.meta.url));

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const shownSides = new Set(["ardia", "aside", "opencode"]);
const agentName = (c) => (c.side === "aside" ? "Aside" : c.agent === "claude" ? "Claude Code" : c.agent === "codex" ? "Codex" : c.agent);
const modelName = (c) => c.label?.match(/\(([^)]+)\)\s*$/)?.[1] ?? c.model;
const round = (v, places) => (typeof v === "number" ? Number(v.toFixed(places)) : null);
const localDay = (iso) => new Date(iso).toLocaleDateString("en-CA");

const contenders = [];
const cells = [];
const days = [];
let tasks = null;
let repeats = 0;
let planned = 0;

for (const dir of resultsDirs) {
  const summary = readJson(join(dir, "summary.json"));
  if (summary.schema !== 1) throw new Error(`unknown summary schema ${summary.schema} in ${dir}`);
  const taskIds = summary.tasks.map((t) => t.id).join(",");
  if (tasks && tasks.map((t) => t.id).join(",") !== taskIds) throw new Error(`${dir} ran different tasks`);
  tasks ??= summary.tasks.map((t) => ({ id: t.id, title: t.title }));
  repeats = Math.max(repeats, summary.repeats ?? 1);
  const taken = new Set(contenders.map((c) => c.id));
  const shown = summary.contenders.filter((c) => shownSides.has(c.side) && !taken.has(c.id));
  const shownIds = new Set(shown.map((c) => c.id));
  planned += summary.tasks.length * shown.length * (summary.repeats ?? 1);
  contenders.push(...shown.map((c) => ({ id: c.id, side: c.side, agent: agentName(c), model: modelName(c) })));
  cells.push(
    ...summary.cells
      .filter((c) => shownIds.has(c.contender))
      .map((c) => ({
        task: c.task,
        contender: c.contender,
        runs: c.runs,
        passes: c.passes,
        time: round(c.median_time_s, 1),
        timePassing: round(c.median_time_s_passing, 1),
        tokens: typeof c.median_tokens === "number" ? Math.round(c.median_tokens) : null,
        frontmost: (c.frontmost_during_run ?? []).filter((n) => n > 0).length,
      })),
  );
  const runFiles = readdirSync(join(dir, "runs")).filter((f) => /--r\d+\.json$/.test(f));
  for (const f of runFiles) {
    const r = readJson(join(dir, "runs", f));
    if (r && !r.harness_error && shownIds.has(r.contender) && r.started_at) days.push(localDay(r.started_at));
  }
}
days.sort();

const data = {
  generated: new Date().toISOString(),
  from: days[0] ?? null,
  to: days.at(-1) ?? null,
  asideVersion,
  opencodeVersion,
  repeats,
  planned,
  runs: cells.reduce((n, c) => n + c.runs, 0),
  tasks,
  contenders,
  cells,
};

writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`);
console.log(`wrote ${out}: ${data.runs} of ${data.planned} runs, ${data.from} to ${data.to}`);
