import { rmSync } from "node:fs";
import { join } from "node:path";
import { ctrlClick, dumpAppMenu, MENU_GEOMETRY, pickAppMenu } from "./_menu.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scratch = process.env.FIXES_SCRATCH ?? join(process.env.HOME, "ardia-scratch/video-fixes");
const SHARED = join(scratch, "ardia-shared");

export default {
  session: "session-r44-folder.json",
  env: { ARDIA_TEST: "appMenu" },
  setup: `return sleep(2000).then(() => { const g = st().groupTabs(["f1", "f2", "f3"], { pinned: true, name: "Trip" }); st().updateGroup(g, { name: "Trip", icon: "🏔️", color: "green", collapsed: false }); globalThis.__g = g; return sleep(800).then(() => { st().updateGroup(g, { collapsed: false }); return sleep(1200); }).then(() => done({ group: g, collapsed: st().groups[g].collapsed })); });`,
  instance: { sharedFolders: SHARED },
  seed() {
    rmSync(SHARED, { recursive: true, force: true });
  },
  async prepare(instance, side) {
    const header = JSON.parse(await instance.eval(`return ac.sidebarRows.measureRow(ac.store.getState().windowOrder[0], globalThis.__g).then((r) => JSON.stringify(r));`));
    const x = Math.round(header.x + header.width * 0.45);
    const y = Math.round(header.y + header.height / 2);
    const menu = await dumpAppMenu(instance, ctrlClick(x, y));
    pickAppMenu(instance, side === "after" ? "shareFolder" : null);
    return { header, x, y, menu };
  },
  act: `${MENU_GEOMETRY}
  const choose = () => dw("mouse:down:" + P.x + "," + P.y + ",1," + 262144).then(() => dw("mouse:up:" + P.x + "," + P.y + ",1," + 262144));
  const menu = P.menu || [];
  const hx = P.x, hy = P.y;
  const g = geometry(menu, hx, hy, -1);
  const share = menu.findIndex((i) => i.id === "shareFolder");
  return at(700, 470).then(() => sleep(500))
  .then(() => move(hx, hy, 800)).then(() => sleep(150)).then(() => click()).then(() => sleep(900))
  .then(() => { mark("go"); mark("⌃-click"); events.push({ t: Date.now(), down: 1 }); return sleep(90); })
  .then(() => { events.push({ t: Date.now(), up: 1 }); events.push({ t: Date.now(), menu: "open", geometry: g, open: -1 }); return sleep(1000); })
  .then(() => move(hx + 60, rowCentre(menu, share >= 0 ? share : Math.min(menu.length - 1, 4), hy), 900)).then(() => sleep(400))
  .then(() => { events.push({ t: Date.now(), down: 1 }); return sleep(90); }).then(() => { events.push({ t: Date.now(), up: 1 }); events.push({ t: Date.now(), menu: "close" }); return choose(); }).then(() => sleep(400))
  .then(() => move(560, 520, 800)).then(() => sleep(3200))
  .then(() => done({ group: st().groups[globalThis.__g] }));`,
  tail: 600,
};
