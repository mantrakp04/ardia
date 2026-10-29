const P = globalThis.acPerf;
const bench = globalThis.acBench;
if (!P || !bench) throw new Error("load bench-app.js first (and turn the perf probe on)");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sum = (o) => Object.values(o ?? {}).reduce((a, b) => a + (typeof b === "number" ? b : 0), 0);

const extra = {
  async launch({ quietMs = 2500, timeoutMs = 30000 } = {}) {
    const state = () => {
      const s = P.read();
      return `${s.commits}:${sum(s.storeUpdates)}:${sum(s.writes)}`;
    };
    const copy = () => JSON.parse(JSON.stringify(P.read()));
    const shownTabs = (s) => {
      const ids = new Set();
      for (const w of Object.values(s.windows)) {
        const id = w.activeTabIds?.[w.profileId];
        if (!id) continue;
        ids.add(id);
        for (const split of Object.values(s.splits ?? {})) if (split.slots.flatMap((x) => x.stack ?? [x.tabId]).includes(id)) for (const pane of split.slots.flatMap((x) => x.stack ?? [x.tabId])) ids.add(pane);
      }
      return ids;
    };
    let backgroundWakeAt = 0;
    const stopWatching = ac.store.subscribe.unprobed((s, prev) => {
      if (backgroundWakeAt || s.tabs === prev.tabs) return;
      const shown = shownTabs(s);
      for (const [id, t] of Object.entries(s.tabs)) {
        const was = prev.tabs[id];
        if (!was || t === was || shown.has(id)) continue;
        if ((t.page.nav && !was.page.nav) || (t.page.adopt && !was.page.adopt)) {
          backgroundWakeAt = Date.now();
          return;
        }
      }
    });
    const end = Date.now() + timeoutMs;
    let last = state();
    let since = Date.now();
    let beforeWake = copy();
    try {
      while (Date.now() < end) {
        await sleep(250);
        if (backgroundWakeAt) return { stats: beforeWake, settled: true, endedAtBackgroundWake: backgroundWakeAt - since, firstCommitMounts: P.firstCommitMounts ?? null };
        const now = state();
        if (now !== last) {
          last = now;
          since = Date.now();
        } else if (Date.now() - since >= quietMs) break;
        beforeWake = copy();
      }
    } finally {
      stopWatching();
    }
    return { stats: P.read(), settled: Date.now() < end, firstCommitMounts: P.firstCommitMounts ?? null };
  },
};

bench.names.push(...Object.keys(extra));
const run = bench.run;
bench.run = (name, options) => (name in extra ? extra[name](options ?? {}) : run(name, options));
return bench.names;
