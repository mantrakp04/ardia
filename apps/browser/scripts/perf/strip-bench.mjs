#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { attach, launch, session, sleep } from "../../../../scripts/lib/instance.mjs";

const HELP = `Top tab strip JS work per interaction: React commits, renders (by component), host updates, store updates,
requestAnimationFrame callbacks and native hover events, from the perf probe of a hidden Debug instance.

  node apps/browser/scripts/perf/strip-bench.mjs <Debug app> <scratch dir> [--profiles 2,4] [--reps 2] [--only hover,collapse,switch]
                                                 [--keep] [--attach] [--out FILE.json] [--top 12]

Each profile count gets its own instance (<scratch dir>/p<N>/data): N profiles, 10 tabs each from a local server, a
group of 3 tabs in each profile, tabLayout "top", a 1360-pt window. Scenarios, each repeated --reps times:
  hover     the pointer sweeps the strip at y=21 from x=90 to x=1290 (30-pt steps, 80 ms apart), dwells 900 ms on the
            fifth chip so the hover card shows, then leaves the strip
  collapse  updateGroup(current profile's group, { collapsed: true }), 1.2 s; then { collapsed: false }, 1.2 s
  switch    ac.actions.switchProfile to the next profile and back, 1.5 s each
--keep leaves the instances running; --attach reuses kept ones (no launch, no seeding).

  node apps/browser/scripts/perf/strip-bench.mjs compare A.json B.json [C.json …]

prints commits/renders/wasted/hostUpdates/raf/hoverEvents per interaction, the last rep of each file side by side.`;

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help") || argv.length < 2) {
  console.log(HELP);
  process.exit(argv.length < 2 ? 1 : 0);
}
if (argv[0] === "compare") {
  compare(argv.slice(1));
  process.exit(0);
}
const [app, scratchArg] = argv;
const scratch = resolve(scratchArg);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const profileCounts = flag("profiles", "2,4").split(",").map(Number);
const reps = Number(flag("reps", "2"));
const only = new Set(flag("only", "hover,collapse,switch").split(","));
const keep = argv.includes("--keep");
const reuse = argv.includes("--attach");
const top = Number(flag("top", "12"));
const outFile = resolve(flag("out", join(scratch, `strip-bench-${Date.now()}.json`)));

const PROFILE_NAMES = ["Personal", "Work", "Play", "Extra", "Fifth", "Sixth"];
const TABS = 10;

function startServer() {
  const server = createServer((req, res) => {
    const name = decodeURIComponent(req.url.split("/").filter(Boolean).join(" ") || "home");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><title>${name}</title><body style="font:14px sans-serif">${name}</body>`);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

function seedSession(profiles, port) {
  const names = PROFILE_NAMES.slice(0, profiles);
  const ids = names.map((n, i) => (i ? n.toLowerCase() : "default"));
  const tabs = ids.flatMap((pid) =>
    Array.from({ length: TABS }, (_, n) => ({ id: `${pid}-t${n}`, profileId: pid, url: `http://127.0.0.1:${port}/${pid}/tab${n}`, title: `${pid} tab ${n}`, lastActiveAt: n + 1 })),
  );
  const s = session({ profiles: names, windows: [{ id: "w1", frame: [60, 60, 1360, 820], sidebarOpen: true }], tabs });
  s.windows[0].tabIds = tabs.map((t) => t.id);
  s.windows[0].activeTabIds = Object.fromEntries(ids.map((pid) => [pid, `${pid}-t0`]));
  return { session: s, ids };
}

const prepareBody = (ids) => `
  const s = ac.store.getState();
  s.updateSettings({ tabLayout: "top" });
  const made = ${JSON.stringify(ids)}.map((pid) => {
    const existing = Object.values(s.groups).find((g) => g.name === "Group " + pid);
    if (existing) return existing.id;
    return ac.store.getState().createGroup([pid + "-t3", pid + "-t4", pid + "-t5"], { name: "Group " + pid, color: "blue" });
  });
  return { groups: made, layout: ac.store.getState().settings.tabLayout, window: ac.store.getState().windowOrder[0] };
`;

const PRELUDE = `
  const P = globalThis.acPerf;
  if (!P) throw new Error("no perf probe: the data dir needs a perf-probe file");
  const w = ac.store.getState().windowOrder[0];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const pointer = (p) => Promise.resolve(ac.shell.devSetPointer(w, p));
  const hoverStats = (reset) => Promise.resolve(ac.shell.devHoverStats ? ac.shell.devHoverStats(reset) : null).catch(() => null);
  const sum = (c) => Object.values(c).reduce((a, b) => a + b, 0);
  const pick = (c, n) => Object.fromEntries(Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, Math.round(v * 10) / 10]));
  const rafOf = (c) => Object.entries(c).filter(([k]) => k.startsWith("requestAnimationFrame")).reduce((a, [, v]) => a + v, 0);
  const summary = (st, hover) => ({
    commits: st.commits,
    renders: sum(st.renders),
    wasted: sum(st.wasted),
    mounts: sum(st.mounts),
    hostUpdates: st.hostUpdates,
    storeUpdates: sum(st.storeUpdates),
    raf: rafOf(st.timers),
    commitMs: Math.round(st.commitMs * 10) / 10,
    hoverEvents: hover && Array.isArray(hover.log) ? hover.log.length : null,
    byComponent: pick(st.renders, ${top}),
    wastedBy: pick(st.wasted, 8),
    storeKeys: pick(st.storeKeys, 6),
    rafBy: pick(Object.fromEntries(Object.entries(st.timers).filter(([k]) => k.startsWith("requestAnimationFrame"))), 4),
  });
  const measure = (run) => hoverStats(true).then(() => { P.reset(); return run(); }).then(() => hoverStats(false)).then((h) => summary(P.read(), h));
  const settle = (ms) => wait(ms);
`;

const scenarios = {
  hover: `${PRELUDE}
    const xs = [];
    for (let x = 90; x <= 1290; x += 30) xs.push(x);
    const step = (x) => () => pointer({ x, y: 21 }).then(() => wait(80));
    return pointer({ x: 600, y: 500 }).then(() => settle(800)).then(() => measure(() => {
      let chain = Promise.resolve();
      for (const x of xs) chain = chain.then(step(x));
      return chain
        .then(() => pointer({ x: 300, y: 21 })).then(() => wait(900))
        .then(() => ({ shown: !!ac.stripHover.useStripHover.getState().hover }))
        .then((r) => pointer({ x: 600, y: 500 }).then(() => wait(700)).then(() => r));
    }));
  `,
  collapse: `${PRELUDE}
    const s0 = ac.store.getState();
    const profile = s0.windows[w].profileId;
    const g = Object.values(s0.groups).find((x) => x.name === "Group " + profile);
    if (!g) throw new Error("no group for " + profile);
    const set = (collapsed) => () => measure(() => { ac.store.getState().updateGroup(g.id, { collapsed }); return wait(1200); });
    return pointer({ x: 600, y: 500 }).then(() => settle(600)).then(set(true)).then((collapse) => set(false)().then((expand) => ({ collapse, expand })));
  `,
  switch: `${PRELUDE}
    const s0 = ac.store.getState();
    const from = s0.windows[w].profileId;
    const order = s0.profileOrder;
    const to = order[(order.indexOf(from) + 1) % order.length];
    const go = (p) => () => measure(() => { ac.actions.switchProfile(w, p); return wait(1500); });
    return pointer({ x: 600, y: 500 }).then(() => settle(600)).then(go(to)).then((there) => go(from)().then((back) => ({ there, back, from, to })));
  `,
};

function print(label, r) {
  const line = (name, x) =>
    `  ${name.padEnd(16)} commits ${String(x.commits).padStart(4)}  renders ${String(x.renders).padStart(5)}  wasted ${String(x.wasted).padStart(5)}  host ${String(x.hostUpdates).padStart(5)}  store ${String(x.storeUpdates).padStart(3)}  raf ${String(x.raf).padStart(4)}  hoverEv ${x.hoverEvents ?? "-"}`;
  console.log(label);
  if (r.commits !== undefined) {
    console.log(line("", r));
    console.log(`    ${JSON.stringify(r.byComponent)}`);
    return;
  }
  for (const [k, v] of Object.entries(r)) if (v && typeof v === "object" && v.commits !== undefined) {
    console.log(line(k, v));
    console.log(`    ${JSON.stringify(v.byComponent)}`);
  }
}

async function run() {
  mkdirSync(scratch, { recursive: true });
  const server = reuse ? null : await startServer();
  const results = { at: new Date().toISOString(), app: resolve(app), runs: {} };
  const instances = [];
  try {
    const opened = await Promise.all(
      profileCounts.map(async (n) => {
        const data = join(scratch, `p${n}`, "data");
        if (reuse) return { n, inst: attach(data), ids: PROFILE_NAMES.slice(0, n).map((name, i) => (i ? name.toLowerCase() : "default")) };
        const seeded = seedSession(n, server.address().port);
        const inst = await launch(app, { data, fresh: true, session: seeded.session, onboarded: true, files: { "perf-probe": "renders" } });
        return { n, inst, ids: seeded.ids };
      }),
    );
    instances.push(...opened.map((o) => o.inst));
    console.log("ready: every instance has loaded its bundle");
    for (const { n, inst, ids } of opened) {
      const prepared = await inst.eval(prepareBody(ids));
      console.log(`p${n}: pid ${inst.pid} ${JSON.stringify(prepared)}`);
    }
    if (!reuse) await sleep(6000);
    for (const { n, inst } of opened) {
      const out = (results.runs[`p${n}`] = {});
      for (const name of ["hover", "collapse", "switch"]) {
        if (!only.has(name)) continue;
        out[name] = [];
        for (let i = 0; i < reps; i++) {
          const r = await inst.eval(scenarios[name], { timeout: 60000 });
          out[name].push(r);
          print(`p${n} ${name} #${i + 1}`, r);
        }
      }
    }
  } finally {
    writeFileSync(outFile, JSON.stringify(results, null, 2));
    console.log(`results: ${outFile}`);
    if (!keep) for (const inst of instances) await inst.quit().catch(() => {});
    server?.close();
  }
}

run().catch((e) => {
  console.error(e.stack ?? e.message);
  process.exit(1);
});

function compare(files) {
  const sides = files.map((f) => JSON.parse(readFileSync(f, "utf8")));
  const keys = ["commits", "renders", "wasted", "hostUpdates", "raf", "hoverEvents"];
  const rows = [];
  const runsOf = (side, p, name) => side.runs[p]?.[name] ?? [];
  for (const p of Object.keys(sides[0].runs))
    for (const name of Object.keys(sides[0].runs[p])) {
      const first = runsOf(sides[0], p, name).at(-1);
      const parts = first && first.commits !== undefined ? [null] : Object.keys(first ?? {}).filter((k) => first[k]?.commits !== undefined);
      for (const part of parts) {
        const pickRun = (side) => {
          const r = runsOf(side, p, name).at(-1);
          return r && (part ? r[part] : r);
        };
        rows.push([`${p} ${name}${part ? ` ${part}` : ""}`, ...sides.map((side) => keys.map((k) => pickRun(side)?.[k] ?? "-").join("/"))]);
      }
    }
  console.log(["interaction", ...files.map((f, i) => `#${i + 1} ${keys.join("/")}`)].join(" | "));
  for (const r of rows) console.log(r.join(" | "));
}
