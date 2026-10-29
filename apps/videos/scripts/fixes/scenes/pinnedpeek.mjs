const link = `(() => { const p = document.createElement("p"); p.className = "def"; p.innerHTML = 'See also: <a id="xlink" href="http://crumbs.example/" style="color:#1f3a5f;text-decoration:underline;font-weight:600">Brown butter oat cookies on Crumbs</a>'; document.querySelector(".entry").appendChild(p); const r = document.getElementById("xlink").getBoundingClientRect(); return JSON.stringify([r.x + r.width / 2, r.y + r.height / 2]); })()`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WEB = { x: 263, y: 50 };
const targets = {};

export default {
  session: "session-peek.json",
  setup: `return sleep(2500).then(() => done({ active: st().windows[W].activeTabIds.default }));`,
  async prepare(instance, side) {
    const page = await instance.page("lexicon");
    const [x, y] = JSON.parse(await page.eval(link));
    targets[side] = { x: Math.round(x), y: Math.round(y) };
    return { ...targets[side], wx: Math.round(WEB.x + x), wy: Math.round(WEB.y + y) };
  },
  async external(instance, side) {
    await sleep(2100);
    const page = await instance.page("lexicon");
    const at = targets[side];
    const events = [];
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
    events.push({ t: Date.now(), down: 1 });
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "left", clickCount: 1 });
    await sleep(90);
    events.push({ t: Date.now(), up: 1 });
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: "left", clickCount: 1 });
    return events;
  },
  act: `return at(760, 700).then(() => sleep(300)).then(() => move(P.wx, P.wy, 800)).then(() => sleep(300)).then(() => { mark("go"); return sleep(3200); }).then(() => done({ r1: st().tabs.r1.url, tabs: Object.keys(st().tabs).length }));`,
  tail: 300,
};
