import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SITES = `http://127.0.0.1:${process.env.FIXES_SITES_PORT ?? 47231}`;
const REOPEN = process.env.N4_REOPEN ?? join(process.env.HOME, "ardia-scratch/film-0245n4/tools/reopen");
const state = () => fetch(`${SITES}/__state`).then((r) => r.json());

export default {
  session: "session-0245n4-close.json",
  minWidth: 800,
  env: { ARDIA_TEST: "appDialog" },
  seed: (data, side) => execFileSync("curl", ["-s", `${SITES}/__set?reopen_${side}=0`]),
  setup: `return sleep(2500).then(() => done({ tabs: st().windows[W].tabIds.length }));`,
  prepare: (instance) => {
    writeFileSync(join(instance.data, "dialog.json.pick"), "cancel");
    return null;
  },
  external: async (instance, side) => {
    const events = [];
    const dialog = join(instance.data, "dialog.json");
    for (const end = Date.now() + 20000; Date.now() < end; await sleep(20)) {
      if (!events.some((e) => e.asked) && existsSync(dialog)) {
        events.push({ t: Date.now(), asked: 1 });
        copyFileSync(dialog, join(instance.data, "dialog-asked.json"));
        writeFileSync(join(instance.data, "dialog.json.pick"), "confirm");
      }
      const s = await state();
      if (s[`reopen_${side}`] === 1) {
        const out = execFileSync(REOPEN, [String(instance.pid)], { encoding: "utf8" });
        const sent = /^sent (\d+)$/m.exec(out);
        if (!sent) throw new Error(`reopen failed: ${out}`);
        events.push({ t: Number(sent[1]), reopen: 1 });
        return events;
      }
    }
    throw new Error("the act never asked for the Dock reopen");
  },
  act: `const fake = (x, y, ms) => {
  const x0 = px, y0 = py, steps = Math.max(1, Math.round(ms / 16));
  const step = (i) => {
    if (i > steps) return Promise.resolve();
    const k = ease(i / steps);
    events.push({ t: Date.now(), x: Math.round((x0 + (x - x0) * k) * 10) / 10, y: Math.round((y0 + (y - y0) * k) * 10) / 10 });
    return sleep(16).then(() => step(i + 1));
  };
  return step(1).then(() => { px = x; py = y; });
};
const fakeClick = () => { events.push({ t: Date.now(), down: 1 }); return sleep(90).then(() => events.push({ t: Date.now(), up: 1 })); };
const before = { tabs: st().windows[W].tabIds.map((id) => st().tabs[id].url), shown: st().tabs[st().windows[W].activeTabIds.default].url };
const open = () => !!st().windows[W];
let asked = false;
const t0 = Date.now();
return at(600, 440).then(() => sleep(400)).then(() => fake(25, 30, 900)).then(() => sleep(350))
  .then(() => { mark("go"); return fakeClick(); }).then(() => dw("close-button"))
  .then(() => sleep(700))
  .then(() => { asked = open(); })
  .then(() => (asked ? fake(460, 243, 700).then(() => sleep(350)).then(() => fakeClick()).then(() => dw("close-button")) : null))
  .then(() => { const wait = t0 + 5800 - Date.now(); return sleep(Math.max(0, wait)); })
  .then(() => { events.push({ t: Date.now(), gone: open() ? 0 : 1 }); return fetch("${SITES}/__set?reopen_" + SIDE + "=1"); })
  .then(() => sleep(3200))
  .then(() => {
    const s = st();
    const w = s.windowOrder[0];
    const win = w && s.windows[w];
    return JSON.stringify({ events, frame: win ? win.frame : null, asked, before, windows: s.windowOrder,
      after: win ? { tabs: win.tabIds.map((id) => s.tabs[id].url), shown: s.tabs[win.activeTabIds[win.profileId]] ? s.tabs[win.activeTabIds[win.profileId]].url : null,
        groups: Object.values(s.groups).filter((g) => g.windowId === w).map((g) => g.name) } : null });
  });`,
  tail: 600,
};
