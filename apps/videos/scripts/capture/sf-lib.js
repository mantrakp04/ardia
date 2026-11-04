const req = (suffix) => {
  const mods = __r.getModules();
  const hit = (mods instanceof Map ? [...mods.entries()] : Object.entries(mods)).find(([, m]) => (m.verboseName || "").endsWith(suffix));
  if (!hit) throw new Error("no module " + suffix);
  return __r(Number(hit[0]));
};
const SF = req("state/sharedFolders/actions.ts");
const GM = req("state/sidebar/groupMenu.ts");
const SM = req("state/sidebar/sidebarMenu.ts");
const SA = req("state/sidebar/actions.ts");
const UI = req("state/sidebar/sidebarUi.ts");
const FOLDER = (typeof ARG !== "undefined" && ARG && ARG.folder) || "Thesis Reading";
let engineWindow = null;
const num = () => (engineWindow ? Promise.resolve(engineWindow) : ac.engine.call("windows.list", {}).then((ws) => (engineWindow = ws.find((w) => w.hasRoot).window)));
const act = (a) => num().then((n) => ac.engine.call("windows.dev", { window: n, action: a }));
const row = (id) => UI.measureRow(W, id);
const folder = () => Object.values(st().groups).find((g) => g.pinned && g.name === FOLDER && !g.parentId);
const linksOf = (g) => (g ? g.tabIds.map((id) => [id, st().tabs[id].customTitle || st().tabs[id].title, st().tabs[id].url]) : []);
const smooth = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x);
const SLOW = { k: 1 };
const slow = (k) => {
  const A = animated();
  if (!SLOW.spring) SLOW.spring = A.spring;
  SLOW.k = k;
  globalThis.sidebarMotionScale = k;
  if (k === 1) { A.spring = SLOW.spring; return; }
  A.spring = (v, cfg) => A.timing(v, { toValue: cfg.toValue, duration: 320 * k, easing: (t) => 1 - Math.pow(1 - t, 3), useNativeDriver: cfg.useNativeDriver });
};
const rows = () => {
  const g = folder();
  const ids = [...Object.values(st().groups).filter((x) => x.pinned).map((x) => x.id), ...st().windows[W].tabIds];
  return ids.reduce((c, id) => c.then((acc) => row(id).then((r) => Object.assign(acc, { [id]: r }))), Promise.resolve({}));
};
const settle = (label, n, ms) => Array.from({ length: n }, (_, i) => i).forEach(() => then(() => sleep(ms).then(() => snap(label))));
const drag = (label, fromId, target, steps, extra) => {
  let a;
  let b;
  then(() => Promise.all([row(typeof fromId === "function" ? fromId() : fromId), target()]).then(([r, t]) => { a = { x: r.x + 70, y: r.y + r.height / 2 }; b = t; }));
  then(() => snap(label + ":grab", Object.assign({ ptr: [a.x, a.y], press: 0 }, extra || {})));
  then(() => act("mouse:down:" + a.x.toFixed(1) + "," + a.y.toFixed(1)).then(() => sleep(40)).then(() => snap(label + ":down", Object.assign({ ptr: [a.x, a.y], press: 1 }, extra || {}))));
  Array.from({ length: steps }, (_, i) => i + 1).forEach((i) => then(() => {
    const t = smooth(i / steps);
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    return act("mouse:dragged:" + x.toFixed(1) + "," + y.toFixed(1)).then(() => sleep(12)).then(() => snap(label, Object.assign({ ptr: [x, y], press: 1, step: i / steps }, extra || {})));
  }));
  then(() => act("mouse:up:" + b.x.toFixed(1) + "," + b.y.toFixed(1)).then(() => snap(label + ":up", Object.assign({ ptr: [b.x, b.y], press: 0, up: Date.now() }, extra || {}))));
};
const between = (aboveId, belowId, x) => () => Promise.all([row(aboveId), row(belowId)]).then(([p, q]) => ({ x: x || p.x + 80, y: (p.y + p.height + q.y) / 2 }));
const above = (id, x) => () => row(id).then((r) => ({ x: x || r.x + 80, y: r.y + 4 }));
const watch = (label, pred, afterMs, maxMs) => then(() => {
  const end = Date.now() + maxMs;
  const wait = () => (pred() ? Promise.resolve(Date.now()) : Date.now() > end ? Promise.reject(new Error(label + ": nothing arrived")) : sleep(8).then(wait));
  return snap(label + ":before").then(wait).then((seen) => {
    const loop = () => (Date.now() - seen > afterMs ? Promise.resolve() : snap(label, { seen }).then(loop));
    return loop();
  });
});
const typeChars = (label, text) => text.split("").forEach((ch) => then(() => Promise.resolve(ac.shell.devTypeKeys(W, ch, 0)).then(() => sleep(90)).then(() => snap(label, { typed: ch }))));
const warmUrls = (urls) => urls.forEach((url) => then(() => {
  const id = st().newTab(W, { url });
  return sleep(2600).then(() => { st().closeTab(id); return sleep(300); });
}));
const descendants = (g) => {
  if (!g) return [];
  const kids = Object.values(st().groups).filter((x) => x.parentId === g.id);
  return [...g.tabIds, ...kids.flatMap((k) => descendants(k))];
};
const signature = () => {
  const walk = (g) => g ? { n: g.name, t: g.tabIds.map((id) => [st().tabs[id].customTitle || st().tabs[id].title, st().tabs[id].url]), k: Object.values(st().groups).filter((x) => x.parentId === g.id).map(walk) } : null;
  return JSON.stringify(walk(folder()));
};
const groupNamed = (name) => Object.values(st().groups).find((g) => g.name === name);
const tabTitled = (text) => {
  const pool = [...descendants(folder()), ...st().windows[W].tabIds];
  return pool.find((id) => ((st().tabs[id].customTitle || st().tabs[id].title || "") + " " + st().tabs[id].url).indexOf(text) >= 0);
};
const refOf = (text) => (groupNamed(text) ? groupNamed(text).id : tabTitled(text));
const placeOf = (to) => {
  if (to.between) return () => Promise.all([row(refOf(to.between[0])), row(refOf(to.between[1]))]).then(([p, q]) => ({ x: p.x + 80, y: (p.y + p.height + q.y) / 2 }));
  if (to.below) return () => row(refOf(to.below)).then((r) => ({ x: r.x + 80, y: r.y + r.height - 3 }));
  return () => row(refOf(to.above)).then((r) => ({ x: r.x + 80, y: r.y + 4 }));
};
