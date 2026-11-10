#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareApp } from "../../../../scripts/lib/app-copy.mjs";
import { evaluate, launch, quit, startServer } from "./js-bench.mjs";
import { buildSeed } from "./seed.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const defaultOut = process.env.AC_PERF_OUT ?? "/tmp/ac-perf-census";

const [command, ...rest] = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[++i];
  else positional.push(rest[i]);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => {
  const s = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function writeSession(dir, origin, version, count, probe) {
  const files = buildSeed(origin, version);
  const session = files["session.json"];
  const w = session.windows[0];
  const base = session.tabs.find((t) => t.profileId === "default");
  const now = Date.now();
  const pinned = Math.min(3, count - 1);
  const grouped = count >= 10 ? 4 : 0;
  const tabs = Array.from({ length: count }, (_, i) => ({
    ...base,
    id: `t-${i}`,
    url: `${origin}/p/tab-${i}`,
    title: `Page tab-${i}`,
    pinned: i < pinned,
    pinnedUrl: i < pinned ? `${origin}/p/tab-${i}` : null,
    createdAt: now - (count - i) * 60_000,
    lastActiveAt: now - (count - i) * 60_000,
  }));
  const active = tabs[Math.min(count - 1, pinned + grouped)];
  active.lastActiveAt = now;
  session.tabs = tabs;
  session.groups = grouped
    ? [{ id: "g-0", windowId: w.id, profileId: "default", name: "Reading", icon: null, color: "blue", collapsed: false, pinned: false, tabIds: tabs.slice(pinned, pinned + grouped).map((t) => t.id), createdAt: now }]
    : [];
  w.tabIds = tabs.map((t) => t.id);
  w.activeTabIds = { default: active.id };
  files["perf-probe"] = probe;
  mkdirSync(dir, { recursive: true });
  for (const [name, value] of Object.entries(files)) writeFileSync(join(dir, name), typeof value === "string" ? value : JSON.stringify(value));
}

const SCENARIOS = ["cenStartup", "wake", "cenNewTab", "cenTypeHero", "cenPanel", "cenEnter", "cenSwitch", "cenHover", "cenBgLoad"];

async function run() {
  const { app, bundle: jsbundle, label, runs = "3", tabs = "20", probe = "renders", port = "47841", out = defaultOut } = flags;
  const debugPort = Number(flags["debug-port"] ?? 9640);
  if (!app || !jsbundle || !label) throw new Error("run needs --app, --bundle and --label");
  const scenarios = flags.only ? ["cenStartup", "wake", ...flags.only.split(",")] : SCENARIOS;
  const clone = prepareApp(app, join(out, "apps", label), { bundle: jsbundle });
  const version = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print CFBundleShortVersionString", join(clone, "Contents/Info.plist")], { encoding: "utf8" }).trim();
  const origin = `http://127.0.0.1:${port}`;
  const server = await startServer(Number(port));
  const lib = readFileSync(join(here, "bench-app.js"), "utf8");
  const results = [];
  try {
    for (let r = 0; r < Number(runs); r++) {
      const dir = join(out, "data", `${label}-${r}`);
      rmSync(dir, { recursive: true, force: true });
      writeSession(dir, origin, version, Number(tabs), probe);
      const { pid } = await launch(clone, dir, debugPort);
      const result = { run: r };
      try {
        let ready = false;
        for (let i = 0; i < 40 && !ready; i++) ready = await evaluate(dir, pid, "return 1;", 2000).then(() => true, (e) => (String(e).includes("exited") ? Promise.reject(e) : false));
        if (!ready) throw new Error("dev harness never answered");
        await evaluate(dir, pid, lib, 60_000);
        if (flags.trace) await evaluate(dir, pid, `acPerf.traceTimers = true; acPerf.traceDepth = ${Number(flags.trace) > 1 ? Number(flags.trace) : 4}; return 1;`);
        if (flags["address-bar"]) await evaluate(dir, pid, `ac.store.getState().updateSettings({ addressBar: ${JSON.stringify(flags["address-bar"])} }); return 1;`);
        for (const name of scenarios) {
          process.stderr.write(`[${label} ${r}] ${name}\n`);
          const options = JSON.stringify({ origin });
          result[name] = await evaluate(dir, pid, `return acBench.run(${JSON.stringify(name)}, ${options});`, 240_000);
          if (name === "cenStartup") result.subscriptions = await evaluate(dir, pid, "return acPerf.subscriptions?.() ?? {};");
        }
        result.subscriptionsAfter = await evaluate(dir, pid, "return acPerf.subscriptions?.() ?? {};");
      } finally {
        await quit(pid);
      }
      results.push(result);
    }
  } finally {
    server.close();
  }
  const report = { label, version, bundle: jsbundle, tabs: Number(tabs), probe, when: new Date().toISOString(), results };
  const file = join(out, `${label}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(markdown(report, 10));
  console.log(`\nwrote ${file}`);
}

const INTERACTIONS = [
  ["launch: first window", "J1", (r) => r.cenStartup, "launch"],
  ["Cmd-T (new tab)", "J2", (r) => r.cenNewTab, "open"],
  ["keystroke, new tab page field", "J2", (r) => r.cenTypeHero, "key"],
  ["Cmd-L (open command bar)", "J2", (r) => r.cenPanel?.open, "open"],
  ["keystroke, command bar", "J2", (r) => r.cenPanel?.keys, "key"],
  ["Esc (close command bar)", "J2", (r) => r.cenPanel?.close, "close"],
  ["tab switch, click", "J3", (r) => r.cenSwitch?.click, "switch"],
  ["tab switch, shortcut", "J3", (r) => r.cenSwitch?.shortcut, "switch"],
  ["Enter (navigate)", "J4", (r) => r.cenEnter?.enter, "enter"],
  ["page load (active tab), after Enter", "J4", (r) => r.cenEnter?.load, "load"],
  ["page load (background tab)", "J4", (r) => r.cenBgLoad, "load"],
  ["sidebar hover (enter and leave a row)", "–", (r) => r.cenHover, "move"],
];

const METRICS = [
  ["renders", "components rendered"],
  ["wasted", "wasted renders"],
  ["hooks", "hooks run"],
  ["subNotified", "subscriptions notified"],
  ["selectors", "selectors evaluated"],
  ["hostUpdates", "native view updates"],
  ["timers", "timers scheduled"],
  ["commits", "commits"],
  ["storeUpdates", "store updates"],
  ["renderMs", "render ms (profiler)"],
  ["ms", "JS ms (act)"],
];

const sum = (o) => Object.values(o ?? {}).reduce((a, b) => a + (typeof b === "number" ? b : 0), 0);
const HOST = /^(View|Text|Pressable|Image|ScrollView|TextInput|InternalTextInput|Animated\(.*\)|Ardia.*|Surface|Symbol|MouseArea|ContextMenuArea|FadeLabel|VirtualizedList.*|CellRenderer.*|ScrollViewBase|TouchableOpacity|AnimatedComponent.*|OutsidePressArea|WindowDragRegion)$/;
const fmt = (v) => (v === null || v === undefined ? "–" : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2).replace(/\.?0+$/, "") || "0");

function collect(report, read) {
  const per = [];
  const stats = {};
  const merge = (into, from) => {
    for (const key of Object.keys(from ?? {})) {
      const v = from[key];
      if (typeof v === "number") into[key] = (into[key] ?? 0) + v;
      else if (v && typeof v === "object" && !Array.isArray(v)) merge((into[key] ??= {}), v);
    }
  };
  for (const r of report.results) {
    const x = read(r);
    if (!x) continue;
    per.push(...x.per);
    merge(stats, x.stats);
  }
  return { per, stats, actions: per.length };
}

function medians(per) {
  return Object.fromEntries(METRICS.map(([k]) => [k, median(per.map((p) => p[k]))]));
}

function table(report) {
  const rows = [];
  for (const [name, journey, read] of INTERACTIONS) {
    const c = collect(report, read);
    if (!c.actions) continue;
    rows.push({ name, journey, actions: c.actions, med: medians(c.per), stats: c.stats });
  }
  return rows;
}

function offenders(stats, actions, n) {
  const rows = Object.keys(stats.renders ?? {})
    .filter((k) => !HOST.test(k))
    .map((k) => ({
      k,
      renders: stats.renders[k] / actions,
      wasted: (stats.wasted?.[k] ?? 0) / actions,
      hooks: (stats.hooks?.[k] ?? 0) / actions,
      ms: (stats.renderMs?.[k] ?? 0) / actions,
      causes: stats.causes?.[k] ?? {},
    }))
    .sort((a, b) => b.renders - a.renders || b.ms - a.ms)
    .slice(0, n);
  return rows.map((r) => {
    const causes = Object.entries(r.causes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([c, v]) => `${c} ${fmt(v / actions)}`)
      .join(", ");
    return `| ${r.k} | ${fmt(r.renders)} | ${fmt(r.wasted)} | ${fmt(r.hooks)} | ${fmt(r.ms)} | ${causes} |`;
  });
}

function selectorRows(stats, actions, n) {
  const calls = stats.selectorCalls ?? {};
  return Object.keys(calls)
    .sort((a, b) => calls[b] - calls[a])
    .slice(0, n)
    .map((k) => `| ${k} | ${fmt(calls[k] / actions)} | ${fmt((stats.subNotified?.[k] ?? 0) / actions)} | ${fmt((stats.selectorMs?.[k] ?? 0) / actions)} |`);
}

function markdown(report, n) {
  const rows = table(report);
  const out = [];
  out.push(`${report.label}: ${report.tabs} tabs, ${report.results.length} runs, probe ${report.probe}. Medians per action.\n`);
  out.push(`| interaction | journey | actions | ${METRICS.map((m) => m[1]).join(" | ")} |`);
  out.push(`|---|---|---:|${METRICS.map(() => "---:").join("|")}|`);
  for (const r of rows) out.push(`| ${r.name} | ${r.journey} | ${r.actions} | ${METRICS.map(([k]) => fmt(r.med[k])).join(" | ")} |`);
  for (const r of rows) {
    out.push(`\n### ${r.name}\n`);
    out.push("| component | renders/action | wasted | hooks | ms | why |\n|---|---:|---:|---:|---:|---|");
    out.push(...offenders(r.stats, r.actions, n));
    const sel = selectorRows(r.stats, r.actions, n);
    if (sel.length) out.push("\n| selector call site | evaluated/action | notified | ms |\n|---|---:|---:|---:|", ...sel);
    const keys = Object.entries(r.stats.storeKeys ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([k, v]) => `${k} ${fmt(v / r.actions)}`)
      .join(", ");
    if (keys) out.push(`\nstore keys changed/action: ${keys}`);
    const timers = Object.entries(r.stats.timersScheduled ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([k, v]) => `${k} ${fmt(v / r.actions)}`)
      .join(", ");
    if (timers) out.push(`timers scheduled/action: ${timers}`);
  }
  const subs = report.results.at(-1)?.subscriptionsAfter;
  if (subs && Object.keys(subs).length) {
    const live = Object.values(subs).reduce((a, b) => a + b, 0);
    out.push(`\n### Live store subscriptions (hooks), end of session: ${live}\n`);
    out.push("| call site | live |\n|---|---:|");
    for (const [k, v] of Object.entries(subs).sort((a, b) => b[1] - a[1]).slice(0, n * 2)) out.push(`| ${k} | ${v} |`);
  }
  return out.join("\n");
}

function compare(a, b) {
  const A = table(JSON.parse(readFileSync(a, "utf8")));
  const B = table(JSON.parse(readFileSync(b, "utf8")));
  const keys = METRICS.filter(([k]) => !["ms", "renderMs"].includes(k)).map(([k]) => k);
  console.log(`| interaction | ${keys.join(" | ")} |\n|---|${keys.map(() => "---:").join("|")}|`);
  for (const x of A) {
    const y = B.find((r) => r.name === x.name);
    if (!y) continue;
    console.log(`| ${x.name} | ${keys.map((k) => (Math.abs((x.med[k] ?? 0) - (y.med[k] ?? 0)) < 0.005 ? fmt(x.med[k]) : `${fmt(x.med[k])} → ${fmt(y.med[k])}`)).join(" | ")} |`);
  }
}

if (command === "run") await run();
else if (command === "report") console.log(markdown(JSON.parse(readFileSync(positional[0], "utf8")), Number(flags.top ?? 10)));
else if (command === "compare") compare(positional[0], positional[1]);
else {
  console.error("usage: census.mjs run --app … --bundle … --label … | report <report.json> [--top 10] | compare <a.json> <b.json>");
  process.exit(64);
}
