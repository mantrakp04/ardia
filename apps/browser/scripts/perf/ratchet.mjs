#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isHarnessTimer } from "./js-bench.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = process.env.RATCHET_APP_DIR ? resolve(process.env.RATCHET_APP_DIR) : resolve(here, "../..");
const repo = resolve(appDir, "../..");
const ceilingsFile = join(here, "ratchet.json");

export const JOURNEYS = ["startup", "launch", "idle", "typing", "switchTabs", "scroll", "hover", "pageLoad", "openClose"];
const OPTIONS = '{"seconds":5}';

const EXACT_SHARE = 1;
const NOISY_SPREAD = 0.3;
const NOISY_MARGIN = 0.1;
const INSTR_TOLERANCE = 0.04;
const NAMED_ROOM = 2;
const MIN_RUNS = 6;

const COUNTERS = ["renders", "mounts", "storeUpdates", "storeKeys", "listenerCalls", "tasks", "timers", "writes", "writeBytes", "commitTasks"];
const FAN_OUT = ["subNotified", "selectorCalls"];
const SCALARS = ["commits", "hostUpdates"];
const TOTALS = new Set([...COUNTERS, ...SCALARS, ...FAN_OUT, "firstCommitMounts"]);

const add = (into, key, value) => {
  into[key] = (into[key] ?? 0) + value;
};

function flattenStats(into, prefix, stats) {
  if (!stats) return;
  for (const k of SCALARS) if (typeof stats[k] === "number") add(into, `${prefix}.${k}`, stats[k]);
  for (const k of COUNTERS) {
    const counter = stats[k];
    if (!counter) continue;
    let total = 0;
    for (const [name, value] of Object.entries(counter)) {
      if (isHarnessTimer(name)) continue;
      add(into, `${prefix}.${k}.${name}`, value);
      total += value;
    }
    add(into, `${prefix}.${k}`, total);
  }
  for (const k of FAN_OUT) {
    const counter = stats[k];
    if (counter) add(into, `${prefix}.${k}`, Object.values(counter).reduce((a, b) => a + (typeof b === "number" ? b : 0), 0));
  }
}

export function flatten(result, prefix = "") {
  const out = {};
  const ran = new Set();
  const one = (scenario, stats) => {
    ran.add(prefix + scenario);
    flattenStats(out, prefix + scenario, stats);
  };
  for (const name of ["launch", "typing", "switchTabs", "scroll", "hover", "storeUpdate", "idle"]) if (result[name]?.stats) one(name, result[name].stats);
  if (result.launch?.firstCommitMounts) {
    let total = 0;
    for (const [name, value] of Object.entries(result.launch.firstCommitMounts)) {
      out[`${prefix}launch.firstCommitMounts.${name}`] = value;
      total += value;
    }
    out[`${prefix}launch.firstCommitMounts`] = total;
  }
  if (prefix) return { counts: out, ran };
  if (result.openClose) {
    ran.add("openClose");
    flattenStats(out, "open", result.openClose.openStats);
    flattenStats(out, "close", result.openClose.closeStats);
  }
  if (result.pageLoad?.runs) {
    ran.add("pageLoad");
    for (const run of result.pageLoad.runs) flattenStats(out, "pageLoad", run.stats);
  }
  if (result.profileSwipe?.runs) {
    ran.add("profileSwipe");
    for (const run of result.profileSwipe.runs) flattenStats(out, `profileSwipe.${run.command}`, run.stats);
  }
  return { counts: out, ran };
}

const scenarioOf = (key) => {
  const [head, second] = key.split(".");
  if (head === "small") return `small.${second}`;
  return head === "open" || head === "close" ? "openClose" : head;
};
const isTotal = (key) => {
  const parts = key.replace(/^small\./, "").split(".");
  return TOTALS.has(parts.at(-1)) && parts.length === (key.includes("profileSwipe.") ? 3 : 2);
};

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

function collect(reports) {
  const values = {};
  const ran = new Set();
  let runs = 0;
  for (const seed of ["big", "small"]) {
    const group = reports.filter((r) => (r.seed ?? "big") === seed);
    if (!group.length) continue;
    const prefix = seed === "small" ? "small." : "";
    const flat = group.flatMap((r) => r.results.map((x) => flatten(x, prefix)));
    const sharedRan = new Set(flat[0]?.ran);
    for (const r of flat) for (const s of [...sharedRan]) if (!r.ran.has(s)) sharedRan.delete(s);
    for (const s of sharedRan) ran.add(s);
    for (const key of new Set(flat.flatMap((r) => Object.keys(r.counts)))) values[key] = flat.map((r) => r.counts[key] ?? 0);
    if (seed === "big") runs = flat.length;
  }
  return { values, runs, ran };
}

const sorted = (xs) => [...xs].sort((a, b) => a - b);
const lowerMedian = (xs) => sorted(xs)[(xs.length - 1) >> 1];

function modeOf(xs) {
  const tally = new Map();
  for (const x of xs) tally.set(x, (tally.get(x) ?? 0) + 1);
  const [value, n] = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return { value, share: n / xs.length };
}

function readCeilings() {
  if (!existsSync(ceilingsFile)) throw new Error(`no ${ceilingsFile}: run \`ratchet.mjs init\` on js-bench reports of several runs`);
  return readJson(ceilingsFile);
}

function reportRevisions(reports) {
  const probe = new Set();
  let bench = "?";
  for (const r of reports) {
    for (const x of r.results) probe.add(x.probeRevision ?? "?");
    bench = r.benchRevision ?? "?";
  }
  return { probe: [...probe].join("+"), bench: String(bench) };
}

function judge(tier, ceilings, counts, ran) {
  const rows = [];
  for (const [key, ceiling] of Object.entries(ceilings)) {
    if (ran && !ran.has(scenarioOf(key))) continue;
    const value = counts[key] ?? 0;
    const limit = tier === "instr" ? Math.floor(ceiling * (1 + INSTR_TOLERANCE)) : tier === "exact" && !isTotal(key) ? ceiling + Math.max(NAMED_ROOM, Math.ceil(ceiling * 0.05)) : ceiling;
    rows.push({ tier, key, ceiling, value, kind: value > limit ? "over" : value < ceiling ? "under" : "same" });
  }
  return rows;
}

function table(rows) {
  const name = (r) => `${r.tier}: ${r.key}`;
  const w = Math.max(...rows.map((r) => name(r).length), 5);
  const line = (a, b, c, d) => `${a.padEnd(w)}  ${String(b).padStart(11)}  ${String(c).padStart(11)}  ${d}`;
  return [line("count", "ceiling", "now", ""), ...rows.map((r) => line(name(r), r.ceiling, r.value, `${r.value > r.ceiling ? "+" : ""}${r.value - r.ceiling}`))].join("\n");
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  const multi = new Set(["micro"]);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const name = argv[i].slice(2);
      const value = argv[i + 1] === undefined || argv[i + 1].startsWith("--") ? "1" : argv[++i];
      if (multi.has(name)) (flags[name] ??= []).push(value);
      else flags[name] = value;
    } else positional.push(argv[i]);
  }
  return { positional, flags };
}

function evaluate(ceilings, { files = [], micro = null, instr = null }) {
  const rows = [];
  const notes = [];
  let ran = null;
  let counts = null;
  let runs = 0;
  if (files.length) {
    const reports = files.map(readJson);
    const rev = reportRevisions(reports);
    if (String(ceilings.revisions.probe) !== rev.probe || String(ceilings.revisions.bench) !== rev.bench)
      notes.push(`WARNING: ratchet.json is for probe revision ${ceilings.revisions.probe}, bench revision ${ceilings.revisions.bench}; this report has probe ${rev.probe}, bench ${rev.bench}. If a counter was redefined (not just added), the ceilings mean something else now: rebuild them with \`ratchet.mjs init\` on a fresh census.`);
    const c = collect(reports);
    ran = c.ran;
    runs = c.runs;
    counts = Object.fromEntries(Object.entries(c.values).map(([k, v]) => [k, lowerMedian(v)]));
    rows.push(...judge("exact", ceilings.exact, counts, ran), ...judge("noisy", ceilings.noisy, counts, ran));
  }
  if (micro) rows.push(...judge("micro", ceilings.micro, micro, null));
  if (instr !== null) rows.push(...judge("instr", ceilings.instr, { "micro.instrPerRound": instr }, null));
  return { rows, notes, ran, counts, runs };
}

function printCheck({ rows, notes, ran, counts, runs }, ceilings, { quiet = false } = {}) {
  const lines = [...notes];
  const over = rows.filter((r) => r.kind === "over");
  const under = rows.filter((r) => r.kind === "under");
  const tiers = ["exact", "noisy", "micro", "instr"].map((t) => [t, rows.filter((r) => r.tier === t)]).filter(([, rs]) => rs.length);
  lines.push(`checked ${tiers.map(([t, rs]) => `${rs.length} ${t}`).join(", ")}${ran ? ` (${[...ran].join(", ")}; ${runs} run${runs === 1 ? "" : "s"})` : ""}: ${over.length} over, ${under.length} below their ceiling`);
  if (over.length) lines.push("", "OVER THE CEILING", table(over));
  if (under.length && !quiet) lines.push("", "below the ceiling (`ratchet.mjs lower` locks the exact ones in)", table(under.slice(0, 30)), under.length > 30 ? `… and ${under.length - 30} more` : "");
  if (counts && !quiet) {
    const known = new Set([...Object.keys(ceilings.exact), ...Object.keys(ceilings.noisy)]);
    const fresh = Object.entries(counts).filter(([k, v]) => !known.has(k) && v > 0 && ran.has(scenarioOf(k)) && !isTotal(k));
    const named = fresh.filter(([k]) => !/\.(storeKeys|listenerCalls)\./.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (named.length) lines.push("", `${fresh.length} counts have no ceiling (a new component, task or timer, or one that wobbles); the biggest:`, ...named.map(([k, v]) => `  ${k}  ${v}`));
  }
  const failed = over.length > 0;
  lines.push("", failed ? "ratchet: FAIL" : "ratchet: ok");
  console.log(lines.join("\n"));
  return !failed;
}

function check(files, micro, instr) {
  const ceilings = readCeilings();
  return printCheck(evaluate(ceilings, { files, micro, instr }), ceilings);
}

const serialize = (c) => {
  const section = (o) => (Object.keys(o).length ? `{\n${Object.keys(o).sort().map((k) => `    ${JSON.stringify(k)}: ${o[k]}`).join(",\n")}\n  }` : "{}");
  return `{\n  "about": ${JSON.stringify(c.about)},\n  "baseline": ${JSON.stringify(c.baseline)},\n  "revisions": ${JSON.stringify(c.revisions)},\n  "exact": ${section(c.exact)},\n  "noisy": ${section(c.noisy)},\n  "micro": ${section(c.micro)},\n  "instr": ${section(c.instr)}\n}`;
};

function lower(files, micro, instr) {
  const ceilings = readCeilings();
  const diff = [];
  const set = (tier, key, ceiling, value) => {
    ceilings[tier][key] = value;
    diff.push({ tier, key, ceiling, value });
  };
  if (files.length) {
    const { values, ran } = collect(files.map(readJson));
    for (const [key, ceiling] of Object.entries(ceilings.exact)) {
      if (!ran.has(scenarioOf(key))) continue;
      const worst = Math.max(...(values[key] ?? [0]));
      if (worst < ceiling) set("exact", key, ceiling, worst);
    }
  }
  if (micro) for (const [key, ceiling] of Object.entries(ceilings.micro)) if ((micro[key] ?? 0) < ceiling) set("micro", key, ceiling, micro[key] ?? 0);
  if (instr !== null) for (const [key, ceiling] of Object.entries(ceilings.instr)) if (instr < ceiling * (1 - INSTR_TOLERANCE)) set("instr", key, ceiling, instr);
  if (!diff.length) return console.log("nothing to lower");
  writeFileSync(ceilingsFile, `${serialize(ceilings)}\n`);
  console.log(table(diff));
  console.log(`\nlowered ${diff.length} ceilings in ${ceilingsFile}`);
}

function init(files, microRuns, instr, { adopt = false } = {}) {
  const reports = files.map(readJson);
  const { values, runs, ran } = collect(reports);
  if (runs < MIN_RUNS) throw new Error(`init needs at least ${MIN_RUNS} runs to tell a steady count from a wobbling one; got ${runs}`);
  const rev = reportRevisions(reports);
  const exact = {};
  const noisy = {};
  const dropped = [];
  for (const [key, v] of Object.entries(values)) {
    const max = Math.max(...v);
    if (max === 0 && !isTotal(key)) continue;
    const mode = modeOf(v);
    if (mode.share >= EXACT_SHARE) {
      if (mode.value > 0 || isTotal(key)) exact[key] = mode.value;
    } else if (isTotal(key) && (max - lowerMedian(v)) / max <= NOISY_SPREAD) noisy[key] = Math.ceil(max * (1 + NOISY_MARGIN));
    else if (isTotal(key)) dropped.push({ key, v });
  }
  const micro = {};
  if (microRuns.length) {
    const runsM = microRuns;
    for (const key of Object.keys(runsM[0])) {
      const vs = runsM.map((r) => r[key]);
      if (new Set(vs).size === 1) micro[key] = vs[0];
      else dropped.push({ key: `micro:${key}`, v: vs });
    }
  }
  const commit = spawnSync("git", ["-C", repo, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const ceilings = {
    about: "Ceilings for apps/browser/scripts/perf/ratchet.mjs (policy in its header and docs/perf/README.md). Lower them with `ratchet.mjs lower`; raise one only by hand, with the reason in the commit.",
    baseline: { commit, runs, scenarios: [...ran].sort(), when: new Date().toISOString().slice(0, 10) },
    revisions: { probe: rev.probe, bench: rev.bench },
    exact,
    noisy,
    micro,
    instr: instr === null ? {} : { "micro.instrPerRound": instr },
  };
  if (adopt) return adoptCeilings(ceilings, dropped);
  writeFileSync(ceilingsFile, `${serialize(ceilings)}\n`);
  console.log(`wrote ${ceilingsFile}: ${Object.keys(exact).length} exact, ${Object.keys(noisy).length} noisy, ${Object.keys(micro).length} micro, ${Object.keys(ceilings.instr).length} instr, over ${runs} runs`);
  if (dropped.length) console.log(`not gated (totals whose median is more than ${NOISY_SPREAD * 100}% below their largest value):\n${dropped.map((d) => `  ${d.key}  [${d.v.join(", ")}]`).join("\n")}`);
}

function adoptCeilings(next, dropped) {
  const old = readCeilings();
  const merged = { ...next, exact: {}, noisy: {}, micro: {}, instr: {} };
  const report = { added: [], lowered: [], higher: [] };
  for (const tier of ["exact", "noisy", "micro", "instr"]) {
    for (const key of new Set([...Object.keys(old[tier]), ...Object.keys(next[tier])])) {
      const was = old[tier][key];
      const now = next[tier][key];
      if (was === undefined) {
        merged[tier][key] = now;
        report.added.push({ tier, key, ceiling: null, value: now });
      } else if (now === undefined || now >= was) {
        merged[tier][key] = was;
        if (now !== undefined && now > was) report.higher.push({ tier, key, ceiling: was, value: now });
      } else {
        merged[tier][key] = now;
        report.lowered.push({ tier, key, ceiling: was, value: now });
      }
    }
  }
  for (const key of Object.keys(merged.exact)) delete merged.noisy[key];
  writeFileSync(ceilingsFile, `${serialize(merged)}\n`);
  const counts = (tier, rows) => rows.filter((r) => r.tier === tier).length;
  console.log(`adopted into ${ceilingsFile}: ${report.added.length} added (${["exact", "noisy", "micro", "instr"].map((t) => `${counts(t, report.added)} ${t}`).join(", ")}), ${report.lowered.length} lowered, ${report.higher.length} kept above what the baseline measured`);
  if (report.lowered.length) console.log(`\nLOWERED\n${table(report.lowered)}`);
  if (report.higher.length) console.log(`\nHIGHER IN THE BASELINE (ceiling kept; a regression or a change to accept by hand)\n${table(report.higher.map((r) => ({ ...r })))}`);
}

function census(files) {
  const { values, runs, ran } = collect(files.map(readJson));
  console.log(`${runs} runs; scenarios ${[...ran].join(", ")}`);
  const rows = Object.entries(values).map(([key, v]) => ({ key, v, min: Math.min(...v), max: Math.max(...v), mode: modeOf(v) }));
  const steady = rows.filter((r) => r.mode.share >= EXACT_SHARE && r.max > 0);
  const wobbly = rows.filter((r) => r.mode.share < EXACT_SHARE);
  const identical = steady.filter((r) => r.min === r.max).length;
  console.log(`${steady.length} steady counts (${identical} identical in every run), ${wobbly.length} wobbling\n`);
  const line = (r) => `  ${r.key.padEnd(58)} ${String(r.min).padStart(9)} – ${String(r.max).padEnd(9)} [${r.v.join(", ")}]`;
  console.log("GROUP TOTALS");
  for (const r of rows.filter((r) => isTotal(r.key)).sort((a, b) => a.key.localeCompare(b.key))) console.log(`${line(r)}${r.mode.share >= EXACT_SHARE ? "" : "   wobbles"}`);
  console.log("\nWOBBLING NAMED COUNTS");
  for (const r of wobbly.filter((r) => !isTotal(r.key)).sort((a, b) => a.key.localeCompare(b.key))) console.log(line(r));
}

const sh = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...options });

function newestApp() {
  const dist = join(repo, "dist");
  const versions = readdirSync(dist)
    .filter((d) => /^\d+\.\d+\.\d+(-rc)?$/.test(d))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of versions) {
    const app = join(dist, v, "export/Ardia.app");
    if (existsSync(app)) return app;
  }
  throw new Error("no dist/<version>/export/Ardia.app: pass --app");
}

function jsSetup(flags, out, mark) {
  const app = flags.app ? resolve(flags.app) : newestApp();
  let jsbundle = flags.bundle ? resolve(flags.bundle) : join(app, "Contents/Resources/main.jsbundle");
  if (!flags.own && !flags.bundle) {
    const bundle = join(out, "bundle");
    mark("bundling the tree");
    sh(process.execPath, [join(here, "js-bench.mjs"), "bundle", bundle], { stdio: ["ignore", "ignore", "inherit"] });
    jsbundle = join(bundle, "main.jsbundle");
  }
  const scenarios = JOURNEYS.join(",");
  const libs = [flags.lib ? resolve(flags.lib) : join(here, "bench-app.js"), join(here, "ratchet-app.js")].join(",");
  const label = flags.label ?? "ratchet";
  const smallLabel = `s${label.slice(1)}`;
  const args = (runs, append, small = false) => {
    const a = [join(here, "js-bench.mjs"), "run", "--app", app, "--bundle", jsbundle, "--label", small ? smallLabel : label, "--runs", String(runs), "--port", flags.port ?? "47831", "--out", out, "--scenarios", small ? "startup,launch" : scenarios, "--options", OPTIONS];
    if (small) a.push("--seed", "small");
    else a.push("--probe", "selectors");
    if (append) a.push("--append", "1");
    a.push("--lib", libs);
    return a;
  };
  return { app, scenarios, report: join(out, `${label}.json`), smallReport: join(out, `${smallLabel}.json`), args };
}

async function run(flags) {
  const started = Date.now();
  const out = resolve(flags.out ?? join(process.env.TMPDIR ?? "/tmp", "ac-ratchet"));
  mkdirSync(out, { recursive: true });
  const mark = (what) => console.error(`[ratchet +${((Date.now() - started) / 1000).toFixed(0)}s] ${what}`);
  const ceilings = readCeilings();
  let setup = null;
  if (!flags["skip-js"]) {
    setup = jsSetup(flags, out, mark);
    mark(`running ${setup.scenarios} on ${setup.app}`);
    sh(process.execPath, setup.args(1, false), { stdio: ["ignore", "ignore", "inherit"] });
    sh(process.execPath, setup.args(1, false, true), { stdio: ["ignore", "ignore", "inherit"] });
  }
  let micro = null;
  let instr = null;
  if (!flags["skip-micro"]) {
    mark("counting the Node hot paths");
    micro = microCounts();
    if (flags.instr) instr = Math.max(instrPerRound(), instrPerRound());
  }
  mark("checking");
  const reports = () => (setup ? [setup.report, setup.smallReport] : []);
  let result = evaluate(ceilings, { files: reports(), micro, instr });
  if (setup && result.rows.some((r) => r.kind === "over" && ["exact", "noisy"].includes(r.tier))) {
    mark("some counts are over: running the scenarios once more (only a count over in both runs fails)");
    sh(process.execPath, setup.args(1, true), { stdio: ["ignore", "ignore", "inherit"] });
    sh(process.execPath, setup.args(1, true, true), { stdio: ["ignore", "ignore", "inherit"] });
    result = evaluate(ceilings, { files: reports(), micro, instr });
  }
  const ok = printCheck(result, ceilings, { quiet: true });
  console.error(`[ratchet] ${((Date.now() - started) / 1000).toFixed(0)}s`);
  process.exit(ok ? 0 : 1);
}

async function baseline(flags) {
  const started = Date.now();
  const out = resolve(flags.out ?? join(process.env.TMPDIR ?? "/tmp", "ac-ratchet-baseline"));
  mkdirSync(out, { recursive: true });
  const mark = (what) => console.error(`[ratchet baseline +${((Date.now() - started) / 1000).toFixed(0)}s] ${what}`);
  const setup = jsSetup(flags, out, mark);
  mark(`running ${setup.scenarios} ${flags.runs ?? 8} times on ${setup.app}`);
  sh(process.execPath, setup.args(flags.runs ?? 8, false), { stdio: ["ignore", "ignore", "inherit"] });
  sh(process.execPath, setup.args(flags.runs ?? 8, false, true), { stdio: ["ignore", "ignore", "inherit"] });
  if (flags["measure-only"]) return console.log(`${setup.report} ${setup.smallReport}`);
  mark("counting the Node hot paths and instructions");
  init([setup.report, setup.smallReport], [microCounts(), microCounts()], Math.max(instrPerRound(), instrPerRound(), instrPerRound()));
}

export function microCounts() {
  const text = sh(process.execPath, ["--no-warnings", "--import", "./src/test-loader.mjs", "scripts/perf/micro-bench.mjs", "counts"], { cwd: appDir });
  const line = text.split("\n").find((l) => l.startsWith("COUNTS "));
  if (!line) throw new Error("micro-bench counts printed no COUNTS line");
  return JSON.parse(line.slice("COUNTS ".length));
}

export function instrPerRound(rounds = 10) {
  const retired = (n) => {
    const r = spawnSync("/usr/bin/time", ["-l", process.execPath, "--no-warnings", "--predictable", "--import", "./src/test-loader.mjs", "scripts/perf/micro-bench.mjs", "instr"], {
      cwd: appDir, encoding: "utf8", env: { ...process.env, INSTR_ROUNDS: String(n) },
    });
    const m = /(\d+)\s+instructions retired/.exec(r.stderr);
    if (!m) throw new Error(`/usr/bin/time -l printed no "instructions retired": ${r.stderr.slice(-300)}`);
    return Number(m[1]);
  };
  return Math.round((retired(rounds) - retired(0)) / rounds);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  try {
    const micro = command !== "init" && flags.micro?.length ? readJson(flags.micro[0]) : null;
    const instr = flags.instr !== undefined && command !== "run" ? Number(flags.instr) : null;
    if (command === "run") await run(flags);
    else if (command === "baseline") await baseline(flags);
    else if (command === "check") process.exit(check(positional, micro, instr) ? 0 : 1);
    else if (command === "lower") lower(positional, micro, instr);
    else if (command === "init") {
      const microRuns = flags.micro ? flags.micro.map(readJson) : [microCounts(), microCounts()];
      init(positional, microRuns, flags["no-instr"] ? null : Math.max(instrPerRound(), instrPerRound(), instrPerRound()), { adopt: !!flags.adopt });
    }
    else if (command === "census") census(positional);
    else {
      console.error("usage: ratchet.mjs run | baseline | check <report.json> | lower <report.json> | init <report.json…> | census <report.json…>  (see the header)");
      process.exit(64);
    }
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exit(2);
  }
}
