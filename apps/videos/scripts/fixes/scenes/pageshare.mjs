import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MENU_GEOMETRY } from "./_menu.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WEB = { x: 263, y: 50 };
const PICK = "Share…";
const LINK = `(() => { const p = document.createElement("p"); p.className = "def"; p.innerHTML = 'See also: <a id="xlink" href="http://crumbs.example/?utm_source=lexicon&utm_medium=link" style="color:#1f3a5f;text-decoration:underline;font-weight:600">Brown butter oat cookies on Crumbs</a>'; document.querySelector(".entry").appendChild(p); const r = document.getElementById("xlink").getBoundingClientRect(); return JSON.stringify([Math.round(r.x + r.width * 0.4), Math.round(r.y + r.height / 2)]); })()`;
const at = {};

async function rightClick(instance, x, y) {
  const page = await instance.page("lexicon");
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "right", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "right", clickCount: 1 });
  page.close();
}

export default {
  session: "session-r44-basic.json",
  env: { ARDIA_TEST: "contextMenu" },
  setup: `st().activate("t3"); return sleep(3000).then(() => done({ active: st().windows[W].activeTabIds.default }));`,
  async prepare(instance, side) {
    const page = await instance.page("lexicon");
    const [x, y] = JSON.parse(await page.eval(LINK));
    page.close();
    at[side] = { x, y };
    const dump = join(instance.data, "context-menu.json");
    rmSync(dump, { force: true });
    await rightClick(instance, x, y);
    for (const end = Date.now() + 5000; !existsSync(dump) && Date.now() < end; ) await sleep(100);
    const menu = existsSync(dump) ? JSON.parse(readFileSync(dump, "utf8")) : { items: [] };
    return { x, y, wx: WEB.x + x, wy: WEB.y + y, items: menu.items };
  },
  async external(instance, side) {
    await sleep(3650);
    if (side === "after") writeFileSync(join(instance.data, "context-menu.json.pick"), PICK);
    await rightClick(instance, at[side].x, at[side].y);
    return [];
  },
  act: `${MENU_GEOMETRY}
  const visible = (P.items || []).filter((i) => i.visible !== false);
  const pickIndex = visible.findIndex((i) => i.label === ${JSON.stringify(PICK)});
  const g = geometry(visible, P.wx, P.wy, -1);
  return at(760, 640).then(() => sleep(300))
  .then(() => move(P.wx, P.wy, 800)).then(() => sleep(250))
  .then(() => { mark("go"); events.push({ t: Date.now(), down: 1 }); return sleep(90); })
  .then(() => { events.push({ t: Date.now(), up: 1 }); events.push({ t: Date.now(), menu: "open", geometry: g, open: -1 }); return sleep(1000); })
  .then(() => move(P.wx + 70, rowCentre(visible, pickIndex >= 0 ? pickIndex : Math.min(visible.length - 1, 5), P.wy), 900)).then(() => sleep(350))
  .then(() => { events.push({ t: Date.now(), down: 1 }); return sleep(90); }).then(() => { events.push({ t: Date.now(), up: 1 }); events.push({ t: Date.now(), menu: "close" }); return sleep(300); })
  .then(() => move(P.wx + 240, P.wy + 160, 700)).then(() => sleep(2600))
  .then(() => done());`,
  tail: 500,
};
