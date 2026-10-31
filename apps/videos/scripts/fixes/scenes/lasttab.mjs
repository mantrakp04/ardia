import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default {
  session: "session-lasttab.json",
  env: { ARDIA_TEST: "appDialog" },
  setup: `return sleep(1500).then(() => done({ unloaded: Object.values(st().tabs).filter((t) => t.unloaded).map((t) => t.id) }));`,
  prepare: (instance) => {
    writeFileSync(join(instance.data, "dialog.json.pick"), "cancel");
    return null;
  },
  external: async (instance) => {
    const dialog = join(instance.data, "dialog.json");
    for (const end = Date.now() + 9000; Date.now() < end; await sleep(20)) {
      if (!existsSync(dialog)) continue;
      const t = Date.now();
      copyFileSync(dialog, join(instance.data, "dialog-asked.json"));
      writeFileSync(join(instance.data, "dialog.json.pick"), "confirm");
      return [{ t, asked: 1 }];
    }
    return [];
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
const tilesBefore = Object.values(st().tabs).filter((t) => t.pinned || t.pin).map((t) => t.id);
let asked = null;
const frame0 = st().windows[W].frame;
return at(700, 520).then(() => sleep(400)).then(() => move(130, 134, 800)).then(() => sleep(600)).then(() => move(237, 134, 300)).then(() => sleep(700))
  .then(() => { mark("go"); return click(); })
  .then(() => sleep(500))
  .then(() => { asked = !!st().tabs.t1; })
  .then(() => (asked ? sleep(700).then(() => fake(680, 236, 700)).then(() => sleep(500)).then(() => fakeClick()).then(() => Promise.resolve(ac.actions.closeTab("t1"))).then(() => sleep(300)).then(() => events.push({ t: Date.now(), gone: st().windowOrder.length === 0 ? 1 : 0 })) : sleep(2300)))
  .then(() => sleep(1800))
  .then(() => JSON.stringify({ events, frame: frame0, asked: !!asked, windows: st().windowOrder, active: st().windows.w1 ? st().windows.w1.activeTabIds : null, tabs: Object.keys(st().tabs), tilesBefore, unloaded: Object.values(st().tabs).filter((t) => t.unloaded).map((t) => t.id) }));`,
  tail: 300,
};
