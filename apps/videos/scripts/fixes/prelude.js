const st = () => ac.store.getState();
const W = st().windowOrder[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const events = [];
let N = null;
let px = null;
let py = null;
let flags = 0;
const ease = (k) => 0.5 - 0.5 * Math.cos(Math.PI * k);
const mainWindow = () => ac.engine.call("windows.list").then((ws) => ws.filter((w) => w.hasRoot)[0].window);
const dw = (action) => Promise.resolve(N === null ? mainWindow().then((n) => (N = n)) : N).then((n) => ac.engine.call("windows.dev", { window: n, action }));
const mark = (name) => events.push({ t: Date.now(), mark: name });
let hover = false;
const at = (x, y) => {
  px = x;
  py = y;
  events.push({ t: Date.now(), x, y });
  return Promise.resolve(hover ? ac.shell.devSetPointer(W, { x, y }) : null).then(() => dw(`mouse:moved:${x},${y}`));
};
const move = (x, y, ms = 600) => {
  if (px === null) return at(x, y);
  const x0 = px;
  const y0 = py;
  const steps = Math.max(1, Math.round(ms / 16));
  const step = (i) => {
    if (i > steps) return Promise.resolve();
    const k = ease(i / steps);
    return at(Math.round((x0 + (x - x0) * k) * 10) / 10, Math.round((y0 + (y - y0) * k) * 10) / 10).then(() => sleep(16)).then(() => step(i + 1));
  };
  return step(1);
};
const press = (down, up, hold = 90) => {
  const extra = flags ? `,1,${flags}` : "";
  events.push({ t: Date.now(), down: 1 });
  return dw(`mouse:${down}:${px},${py}${extra}`).then(() => sleep(hold)).then(() => {
    events.push({ t: Date.now(), up: 1 });
    return dw(`mouse:${up}:${px},${py}${extra}`);
  });
};
const click = () => press("down", "up");
const middleClick = () => press("otherdown", "otherup");
const withKeys = (keyFlags, label, fn) => {
  flags = keyFlags;
  mark(label);
  return Promise.resolve(fn()).then(() => { flags = 0; });
};
const key = (label, keyFlags, chars, code) => {
  mark(label);
  return dw(`keys:${keyFlags}:${chars}:${code}`);
};
const hide = () => events.push({ t: Date.now(), hide: 1 });
const CMD = 1048576;
const SHIFT = 131072;
const OPT = 524288;
const done = (extra) => JSON.stringify(Object.assign({ events, frame: st().windows[W].frame }, extra || {}));
const KEYCODES = { a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17, o: 31, u: 32, i: 34, p: 35, l: 37, j: 38, k: 40, n: 45, m: 46, " ": 49 };
const typeText = (text, gap = 120) => text.split("").reduce((p, ch) => p.then(() => dw(`keys:0:${ch}:${KEYCODES[ch]}`)).then(() => sleep(gap)), Promise.resolve());
