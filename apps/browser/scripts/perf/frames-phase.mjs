import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CAP_LOG = process.env.AC_CPU_CAP_LOG ?? "/private/tmp/claude-501/-Users-barreloflube-Documents-ardia/a6e87140-35e6-4a65-85e0-018a5c019c75/scratchpad/cpu-cap.log";
const capRunning = () => spawnSync("pgrep", ["-f", "scripts/agent/cpu-cap"]).status === 0;
const capSize = () => {
  try {
    return readFileSync(CAP_LOG).length;
  } catch {
    return 0;
  }
};
const capPauses = (from, app, pid) => {
  try {
    return readFileSync(CAP_LOG, "utf8").slice(from).split("\n").filter((l) => l.includes(": paused ") && (l.includes(app) || new RegExp(`paused ${pid} `).test(l))).length;
  } catch {
    return 0;
  }
};

const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function framesLibrary(toolDir, here) {
  const lib = join(toolDir, "acframes.dylib");
  const src = join(here, "acframes.m");
  if (!existsSync(lib) || readFileSync(src, "utf8") !== (existsSync(lib + ".src") ? readFileSync(lib + ".src", "utf8") : "")) {
    execFileSync("clang", ["-dynamiclib", "-fobjc-arc", "-framework", "AppKit", "-framework", "QuartzCore", "-arch", "arm64", src, "-o", lib], { stdio: "inherit" });
    execFileSync("codesign", ["--force", "--sign", "-", lib]);
    writeFileSync(lib + ".src", readFileSync(src, "utf8"));
  }
  return lib;
}

class Records {
  constructor(file) {
    this.file = file;
    this.offset = 0;
    this.tail = "";
    this.f = [];
    this.m = [];
    this.j = [];
    this.l = [];
    this.keys = [];
    this.info = null;
  }
  read() {
    let text;
    try {
      const buf = readFileSync(this.file);
      text = this.tail + buf.subarray(this.offset).toString("utf8");
      this.offset = buf.length;
    } catch {
      return this;
    }
    const lines = text.split("\n");
    this.tail = lines.pop();
    for (const line of lines) {
      let r;
      try {
        r = JSON.parse(line);
      } catch {
        continue;
      }
      if (r.k === "f") this.f.push(r);
      else if (r.k === "r") (r.th === "m" ? this.m : this.j).push(r);
      else if (r.k === "l") this.l.push(r);
      else if (r.k === "key") this.keys.push(r);
      else if (r.k === "info") this.info = r;
    }
    return this;
  }
}

export function windowStats(rec, a, b, refresh) {
  const ticks = rec.f;
  let first = 0;
  while (first + 1 < ticks.length && ticks[first + 1].ts <= a) first++;
  let last = first;
  while (last < ticks.length - 1 && ticks[last].ts < b) last++;
  const gaps = [];
  let late = 0;
  for (let i = first + 1; i <= last; i++) {
    gaps.push(ticks[i].ts - ticks[i - 1].ts);
    late = Math.max(late, ticks[i].now - ticks[i].ts);
  }
  const from = ticks[first]?.ts ?? a, to = ticks[last]?.ts ?? b;
  const busy = (list) => {
    let sum = 0, worst = 0, over = 0;
    for (const r of list) {
      const s = Math.max(r.a, from), e = Math.min(r.a + r.d, to);
      if (e > s) sum += e - s;
      if (r.a + r.d >= from && r.a <= to) {
        worst = Math.max(worst, r.d);
        if (r.d > 8.33) over++;
      }
    }
    return { sum, worst, over };
  };
  const m = busy(rec.m), j = busy(rec.j);
  const cpu = (key) => (ticks[first]?.[key] >= 0 && ticks[last]?.[key] >= 0 ? ticks[last][key] - ticks[first][key] : NaN);
  const l = rec.l.filter((r) => r.a >= from && r.a <= to);
  return {
    frames: gaps.length,
    span: to - from,
    over8: gaps.filter((g) => g > 8.33 + 2).length,
    over16: gaps.filter((g) => g > 16.7 + 2).length,
    dropped: gaps.reduce((n, g) => n + Math.max(0, Math.round(g / refresh) - 1), 0),
    worst: gaps.length ? Math.max(...gaps) : NaN,
    late,
    mainBusy: cpu("mc"),
    mainLoop: m.sum,
    mainWorst: m.worst,
    mainOver8: m.over,
    jsBusy: cpu("jc"),
    jsLoop: j.sum,
    jsWorst: j.worst,
    layoutMs: l.reduce((n, r) => n + r.d, 0),
  };
}

function interactions(c) {
  const { app, key, sleep, run, W, probe, base } = c;
  const seedTab = `(() => { const s = ac.store.getState(); return Object.keys(s.tabs).find((id) => s.tabs[id].url.includes("id=seed")); })()`;
  const reset = () => run(`const s = ac.store.getState(); const w = ${W};
    if (s.windowUi[w]?.panel.open) s.closePanel(w);
    for (const id of s.windows[w].tabIds) if (!s.tabs[id].url && s.windows[w].tabIds.length > 1) ac.store.getState().closeTab(id);
    const seed = ${seedTab}; if (seed && s.windows[w].activeTabIds[s.windows[w].profileId] !== seed) ac.store.getState().activate(seed);
    return true;`);
  const store = (code) => run(`globalThis.acPerf?.reset(); const t = ac.now(); ${code}; return t;`);
  let k = 0;
  const want = async (open) => {
    if ((await run(`return ${"ac.store.getState().windows[" + W + "].sidebarOpen"};`)) !== open) {
      await run(`ac.store.getState().toggleSidebar(${W}); return 1;`);
      await sleep(2500);
    }
  };
  const arcLayout = async (on) => {
    const value = on ? "sidebar" : "toolbar";
    if ((await run(`return ac.store.getState().settings.addressBar;`)) === value) return;
    await run(`ac.store.getState().updateSettings({ addressBar: "${value}" }); return 1;`);
    await sleep(1500);
  };
  const ui = `ac.store.getState().windowUi[${W}]?.panel.open`;
  const win = `ac.store.getState().windows[${W}]`;
  return [
    { name: "idle (no interaction)", window: 1500, go: async () => Date.now() },
    { name: "new tab with the command bar (⌘T)", window: 600, verify: `const s = ac.store.getState(); return s.windows[${W}].tabIds.some((id) => !s.tabs[id].url);`, go: () => key("cmd+t"), after: async () => { await sleep(900); } },
    { name: "close the new tab (⌘W)", window: 600, before: () => key.open("cmd+t"), verify: `const s = ac.store.getState(); return !s.windows[${W}].tabIds.some((id) => !s.tabs[id].url);`, go: () => key("cmd+w"), after: reset },
    { name: "command bar open (⌘L)", window: 600, verify: `return !!${ui};`, before: reset, go: () => key("cmd+l"), after: async () => { await sleep(900); } },
    { name: "command bar close (Esc, from ⌘L)", window: 600, verify: `return !${ui};`, before: async () => { await reset(); await key.open("cmd+l"); }, go: () => key("esc"), after: reset },
    { name: "tab switch", window: 500, verify: `const s = ac.store.getState(); return s.windows[${W}].activeTabIds[s.windows[${W}].profileId] === globalThis.__frameTarget;`, before: reset, go: () => run(`globalThis.acPerf?.reset(); const t = ac.now(); const s = ac.store.getState(); const w = ${W};
        const ids = s.windows[w].tabIds.filter((id) => !s.tabs[id].pin); const id = ids[(${k++} * 7 + 3) % ids.length];
        globalThis.__frameTarget = id; ac.actions.switchToTab(id); return t;`) },
    { name: "sidebar collapse", window: 800, verify: `return !${win}.sidebarOpen;`, before: async () => { await reset(); await want(true); }, go: () => store(`ac.store.getState().toggleSidebar(${W})`) },
    { name: "sidebar expand", window: 800, verify: `return ${win}.sidebarOpen;`, before: async () => { await reset(); await want(false); }, go: () => store(`ac.store.getState().toggleSidebar(${W})`), after: () => sleep(300) },
    { name: "sidebar collapse (address bar in the sidebar)", window: 800, verify: `return !${win}.sidebarOpen;`, before: async () => { await reset(); await arcLayout(true); await want(true); }, go: () => store(`ac.store.getState().toggleSidebar(${W})`) },
    { name: "sidebar expand (address bar in the sidebar)", window: 800, verify: `return ${win}.sidebarOpen;`, before: async () => { await reset(); await arcLayout(true); await want(false); }, go: () => store(`ac.store.getState().toggleSidebar(${W})`), after: async () => { await sleep(300); await arcLayout(false); } },
    { name: "profile swipe (next profile)", window: 1200, verify: `return ${win}.profileId !== globalThis.__frameProfile;`, before: async () => { await reset(); await run(`globalThis.__frameProfile = ${win}.profileId; return 1;`); }, go: () => store(`ac.runCommand({ command: "nextProfile", arg: null, windowId: ${W} })`), after: () => sleep(600) },
    { name: "profile swipe (previous profile)", window: 1200, verify: `return ${win}.profileId !== globalThis.__frameProfile;`, before: () => run(`globalThis.__frameProfile = ${win}.profileId; return 1;`), go: () => store(`ac.runCommand({ command: "previousProfile", arg: null, windowId: ${W} })`), after: () => sleep(600) },
    { name: "sidebar scroll (200 tabs, flick down and back)", window: 2300, before: reset,
      go: async () => { await run(`globalThis.acPerf?.reset(); return 1;`); const t = Date.now(); await probe("scroll", { distance: 4000, seconds: 1, back: true }, false); return t; } },
    { name: "sidebar hover (20 rows, 60 ms apart)", window: 1500, before: reset, go: async () => { await run(`globalThis.acPerf?.reset(); return 1;`); const t = Date.now(); await probe("hover", { rows: 20, gapMs: 60 }, false); return t; } },
    { name: "new window", window: 1200, verify: `return ac.store.getState().windowOrder.length > globalThis.__frameWindows;`, before: async () => { await reset(); await run(`globalThis.__frameWindows = ac.store.getState().windowOrder.length; return 1;`); },
      go: () => store(`ac.actions.openWindow({ url: "${base()}/static?id=fw${k++}" })`),
      after: async () => { await sleep(1500); await run(`const s = ac.store.getState(); for (const id of s.windowOrder) if (s.windows[id] && id !== ${W} && !s.windows[id].kind) ac.store.getState().closeWindow(id); return true;`); await sleep(1500); } },
  ];
}

export async function framesRun(c, side, i, { counts }) {
  const { Instance, freshDir, acperf, sleep, log, WINDOW, base, opt, toolDir } = c;
  const display = JSON.parse(acperf("display").out || "{}");
  if (display.asleep || display.locked) {
    log(`${side.tag}frames ${i}: the display is ${display.asleep ? "asleep" : "locked"}; macOS gives no frames then, skipped`);
    side.results.frames.push({ skipped: display.asleep ? "display asleep" : "screen locked", counts });
    return;
  }
  const dir = freshDir(side, `frames-${i}${counts ? "c" : ""}`);
  if (counts) writeFileSync(join(dir, "perf-probe"), "");
  const app = new Instance(side, dir);
  app.frames = true;
  app.env.push("AC_BENCH_FRAMES=1");
  const rec = new Records(join(dir, "bench-frames.jsonl"));
  const run = (code) => app.run(code);
  let seq = 0;
  const probe = async (op, args = {}, wait = true) => {
    const id = `f${++seq}-${Date.now()}`;
    writeFileSync(join(dir, "bench-frames-cmd.json"), JSON.stringify({ id, op, ...args }));
    if (!wait) return { id };
    const r = await app.waitFile("bench-frames-result.json", 60_000, (v) => v.id === id);
    if (!r?.ok) throw new Error(`probe ${op}: ${JSON.stringify(r)}`);
    return r;
  };
  const key = async (spec) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = acperf("postkeys", String(app.pid), "0", spec);
      const press = JSON.parse(r.out.split("\n").filter(Boolean)[0]);
      for (const end = Date.now() + 1000; Date.now() < end; await sleep(15)) {
        const seen = rec.read().keys.find((x) => x.made >= press.at - 5 && x.made < press.at + 400);
        if (seen) return seen.made;
      }
    }
    throw new Error(`key ${spec} never arrived`);
  };
  key.open = async (spec) => {
    await key(spec);
    await sleep(900);
  };
  const capFrom = capSize();
  const out = { info: null, display, counts, interactions: {}, load: [Math.round(c.loadavg()[0])], cpuCap: { running: capRunning(), pauses: 0 } };
  const counters = () => probe("counters");
  const quiet = async (maxMs) => {
    let last = null, since = Date.now();
    for (const end = Date.now() + maxMs; Date.now() < end; await sleep(200)) {
      const c = await counters();
      const now = `${c.mountBatches}:${c.uiBlocks}`;
      if (now !== last) (last = now), (since = Date.now());
      else if (Date.now() - since >= 900) return true;
    }
    return false;
  };
  const jsCounts = () => run(`const p = globalThis.acPerf?.read(); if (!p) return null; const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    const top = (o, n = 6) => Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, n).map(([k, v]) => k + " " + v).join(", ");
    return { commits: p.commits, hostUpdates: p.hostUpdates, renders: sum(p.renders), storeUpdates: sum(p.storeUpdates), tasks: sum(p.tasks),
      what: { renders: top(p.renders), tasks: top(p.tasks), timers: top(p.timers), storeKeys: top(p.storeKeys) } };`);
  try {
    await app.launch();
    await app.pageState("id=seed", 30_000, (s) => s.fcp);
    await sleep(3000);
    for (const end = Date.now() + 60_000; !rec.read().info && Date.now() < end; ) await sleep(100);
    if (!rec.info) throw new Error("the frame probe didn't start (no display link)");
    const info = await probe("info");
    out.info = { screen: info.screen, maxFPS: info.maxFPS, js: info.js };
    const refresh = 1000 / info.maxFPS;
    const settledAt = Date.now();
    out.settled = await quiet(30_000);
    out.settleMs = Date.now() - settledAt;
    log(`${side.tag}frames ${i}${counts ? " (counts)" : ""}: ${info.screen} ${info.maxFPS} Hz, JS thread ${info.js ? "observed" : "NOT found"}; ${out.settled ? "quiet" : "never quiet"} after ${Math.round(out.settleMs / 1000)} s`);
    const reps = counts ? Math.min(3, +opt["frames-n"]) : +opt["frames-n"];
    const only = opt["frames-only"] ? new RegExp(opt["frames-only"], "i") : null;
    const list = interactions({ app, key, sleep, run, W: WINDOW, probe, base }).filter((it) => !only || only.test(it.name));
    for (const it of list) {
      const rows = [];
      const taken = [];
      let sampler = null;
      if (opt["frames-sample"] && !it.name.startsWith("idle")) {
        mkdirSync(join(c.out ?? dir, "frames-sample"), { recursive: true });
        const file = join(c.out ?? dir, "frames-sample", `${side.label}-${it.name.replace(/[^a-z0-9]+/gi, "-")}.txt`);
        const child = spawn("sample", [String(app.pid), String(Math.ceil(reps * (it.window / 1000 + 4))), "2", "-file", file], { stdio: "ignore" });
        sampler = new Promise((done) => (child.on("close", done), child.on("error", done)));
      }
      for (let rep = 0; rep < (it.name.startsWith("idle") ? 2 : reps); rep++) {
        try {
          if (it.before) await it.before();
          if (!(await quiet(5000))) out.notQuiet = (out.notQuiet ?? 0) + 1;
          if (counts) await run(`globalThis.acPerf?.reset(); return 1;`);
          const c0 = await counters();

          const t0 = await it.go();
          await sleep(it.window + 250);
          const c1 = await counters();
          if (it.verify && !(await run(it.verify))) {
            log(`${side.tag}frames ${i} ${it.name} #${rep}: no effect (the interaction didn't do what it should); left out`);
            if (it.after) await it.after().catch(() => {});
            out.noEffect = (out.noEffect ?? 0) + 1;
            continue;
          }
          const extra = {};
          for (const n of ["layoutPasses", "mountBatches", "uiBlocks", "viewUpdates", "viewCreates"]) extra[n] = c1[n] - c0[n];
          if (counts) Object.assign(extra, await jsCounts());
          taken.push({ t0, extra });
        } catch (error) {
          log(`${side.tag}frames ${i} ${it.name} #${rep}: lost (${String(error.message ?? error).slice(0, 160)})`);
        }
        if (it.after) await it.after().catch(() => {});
      }
      if (sampler) await Promise.race([sampler, sleep(120_000)]);
      await sleep(2500);
      rec.read();
      for (const { t0, extra } of taken) {
        const stats = { ...windowStats(rec, t0, t0 + it.window, refresh), ...extra, expected: Math.round(it.window / refresh), t0 };
        if (stats.frames) rows.push(stats);
      }
      out.interactions[it.name] = rows;
      log(`${side.tag}frames ${i} ${it.name}: ${rows.length} reps, frames ${median(rows.map((r) => r.frames))}, >8.33 ${median(rows.map((r) => r.over8))}, worst ${median(rows.map((r) => r.worst)).toFixed?.(1)} ms, main worst ${median(rows.map((r) => r.mainWorst)).toFixed?.(1)} ms`);
    }
    const after = JSON.parse(acperf("display").out || "{}");
    out.displayAfter = after;
    out.cpuCap.pauses = capPauses(capFrom, app.app, app.pid);
    out.cpuCap.running ||= capRunning();
    out.load.push(Math.round(c.loadavg()[0]));
    side.results.frames.push(out);
  } finally {
    await app.done();
  }
}

const METRICS = [
  ["frames", "frames delivered", "", 0],
  ["over8", "ticks over 8.33 ms", "", 0],
  ["over16", "ticks over 16.7 ms", "", 0],
  ["dropped", "refresh intervals skipped", "", 0],
  ["worst", "worst frame", "ms", 1],
  ["mainBusy", "main thread busy", "ms", 1],
  ["mainWorst", "main thread longest stall", "ms", 1],
  ["jsBusy", "JS thread busy", "ms", 1],
  ["jsWorst", "JS thread longest task", "ms", 1],
  ["layoutPasses", "layout passes", "", 0],
  ["mountBatches", "mount batches", "", 0],
  ["uiBlocks", "UI blocks run", "", 0],
  ["viewUpdates", "view updates sent by JS", "", 0],
  ["commits", "React commits", "", 0],
  ["hostUpdates", "React host updates", "", 0],
  ["renders", "React renders", "", 0],
  ["storeUpdates", "store updates", "", 0],
];
const SHOWN = new Set(["frames", "over8", "over16", "worst", "mainBusy", "mainWorst", "jsBusy", "layoutPasses", "commits", "hostUpdates"]);

export function frameRows(results) {
  const runs = (results.frames ?? []).filter((r) => !r.skipped);
  const rows = [];
  const skipped = (results.frames ?? []).length - runs.length;
  if (skipped) rows.push({ name: "frames: runs skipped (display asleep or screen locked)", median: skipped, min: skipped, max: skipped, n: skipped, unit: "", digits: 0 });
  if (!runs.length) return rows;
  const capped = runs.filter((r) => r.cpuCap?.running).length, paused = runs.filter((r) => r.cpuCap?.pauses).length;
  if (capped) rows.push({ name: "frames: runs under scripts/agent/cpu-cap (background QoS: efficiency cores, absolute numbers read worse)", median: capped, min: capped, max: capped, n: runs.length, unit: "", digits: 0 });
  if (paused) rows.push({ name: "frames: runs cpu-cap PAUSED the instance in (timings invalid)", median: paused, min: paused, max: paused, n: runs.length, unit: "", digits: 0 });
  const first = runs.find((r) => r.info);
  if (first) rows.push({ name: `frames: screen ${first.info.screen}, maximum refresh rate (Hz)`, median: first.info.maxFPS, min: first.info.maxFPS, max: first.info.maxFPS, n: runs.length, unit: "Hz", digits: 0 });
  const names = [...new Set(runs.flatMap((r) => Object.keys(r.interactions)))];
  for (const name of names)
    for (const [key, label, unit, digits] of METRICS) {
      if (!SHOWN.has(key)) continue;
      const perRun = runs.map((r) => median((r.interactions[name] ?? []).map((x) => x[key]))).filter(Number.isFinite);
      if (!perRun.length) continue;
      rows.push({ name: `frames ${name}: ${label}`, median: median(perRun), min: Math.min(...perRun), max: Math.max(...perRun), n: perRun.length, unit, digits });
    }
  return rows;
}

export function frameTable(resultsByLabel) {
  const labels = Object.keys(resultsByLabel);
  const keys = ["frames", "over8", "over16", "worst", "mainBusy", "mainWorst", "jsBusy", "jsWorst", "layoutPasses", "mountBatches", "uiBlocks", "commits", "hostUpdates"];
  const names = [...new Set(labels.flatMap((l) => (resultsByLabel[l].frames ?? []).flatMap((r) => Object.keys(r.interactions ?? {}))))];
  const out = [];
  out.push(`| Interaction | App | ${keys.map((k) => METRICS.find((m) => m[0] === k)[1]).join(" | ")} |`);
  out.push(`|---|---|${keys.map(() => "---").join("|")}|`);
  for (const name of names)
    for (const label of labels) {
      const reps = (resultsByLabel[label].frames ?? []).filter((r) => !r.skipped).flatMap((r) => r.interactions[name] ?? []);
      const cell = (k) => {
        const v = median(reps.map((x) => x[k]));
        return Number.isFinite(v) ? (METRICS.find((m) => m[0] === k)[3] ? v.toFixed(1) : Math.round(v)) : "";
      };
      out.push(`| ${name} | ${label} | ${keys.map(cell).join(" | ")} |`);
    }
  return out.join("\n");
}

const RATCHET_FILE = join(dirname(fileURLToPath(import.meta.url)), "frames-ratchet.json");
const GATED = ["layoutPasses", "mountBatches", "uiBlocks", "viewUpdates", "commits", "hostUpdates"];
const NOT_GATED = ["idle (no interaction)", "new window"];

function repsOf(results, name) {
  return (results.frames ?? []).filter((r) => !r.skipped).flatMap((r) => r.interactions?.[name] ?? []);
}

export function ratchetInit(results) {
  const names = [...new Set((results.frames ?? []).flatMap((r) => Object.keys(r.interactions ?? {})))].filter((n) => !NOT_GATED.includes(n));
  const ceilings = {};
  for (const name of names) {
    ceilings[name] = {};
    for (const key of GATED) {
      const values = repsOf(results, name).map((x) => x[key]).filter(Number.isFinite);
      if (!values.length) continue;
      const max = Math.max(...values);
      ceilings[name][key] = values.every((v) => v === max) ? max : Math.ceil(max * 1.1);
    }
  }
  return { revision: 2, proof: Object.fromEntries(GATED.map((key) => [key, null])), ceilings };
}

export function ratchetCheck(results, ratchet) {
  const rows = [];
  const proven = (key) => !!ratchet.proof?.[key];
  for (const [name, limits] of Object.entries(ratchet.ceilings)) {
    for (const [key, ceiling] of Object.entries(limits)) {
      const values = repsOf(results, name).map((x) => x[key]).filter(Number.isFinite);
      if (!values.length) continue;
      const got = median(values);
      rows.push({ name, key, ceiling, got, over: got > ceiling, proven: proven(key) });
    }
  }
  return rows;
}

if (process.argv[1] && process.argv[1].endsWith("frames-phase.mjs")) {
  const [cmd, ...files] = process.argv.slice(2);
  const load = (f) => JSON.parse(readFileSync(f, "utf8"));
  if (cmd === "table") {
    const by = {};
    for (const f of files) {
      const r = load(f);
      by[r.meta?.label ?? f] = r;
    }
    console.log(frameTable(by));
  } else if (cmd === "init") {
    writeFileSync(RATCHET_FILE, JSON.stringify(ratchetInit(load(files[0])), null, 1) + "\n");
    console.log(`wrote ${RATCHET_FILE}`);
  } else if (cmd === "check") {
    const rows = ratchetCheck(load(files[0]), load(RATCHET_FILE));
    const over = rows.filter((r) => r.over && r.proven);
    const advisory = rows.filter((r) => r.over && !r.proven);
    for (const r of over) console.log(`over: ${r.name}: ${r.key} ${r.got} > ${r.ceiling} (proven)`);
    for (const r of advisory) console.log(`advisory (unproven): ${r.name}: ${r.key} ${r.got} > ${r.ceiling}`);
    const below = rows.filter((r) => r.got < r.ceiling).length;
    console.log(`frames ratchet: ${over.length ? "FAILED" : "ok"} (${rows.length} counts: ${rows.filter((r) => r.proven).length} proven, ${rows.filter((r) => !r.proven).length} unproven; ${over.length} proven over, ${advisory.length} unproven over, ${below} below their ceiling)`);
    process.exit(over.length ? 1 : 0);
  } else {
    console.error("usage: frames-phase.mjs table <results.json>... | init <framecounts results.json> | check <results.json>");
    process.exit(64);
  }
}
