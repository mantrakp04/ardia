export const SMALL_FRAME = [760, 160, 620, 560];
export const SMALL_OFFSET = [680, 200];

export const openSmall = (url) => `globalThis.__small = st().createWindow({ kind: "small", url: ${JSON.stringify(url)}, frame: ${JSON.stringify(SMALL_FRAME)} }); return sleep(3500).then(() => done({ small: globalThis.__small, frame: st().windows[globalThis.__small].frame, kind: st().windows[globalThis.__small].kind }));`;

export const smallHelpers = `const SO = ${JSON.stringify(SMALL_OFFSET)};
const smallWindow = () => ac.engine.call("windows.list").then((ws) => ws.find((w) => w.frame.startsWith("{{${SMALL_FRAME[0]}, ${SMALL_FRAME[1]}}")).window);
const sat = (x, y) => { px = x; py = y; events.push({ t: Date.now(), x: x + SO[0], y: y + SO[1] }); return dw("mouse:moved:" + x + "," + y); };
const smove = (x, y, ms) => { const x0 = px, y0 = py, steps = Math.max(1, Math.round(ms / 16)); const step = (i) => i > steps ? Promise.resolve() : sat(Math.round((x0 + (x - x0) * ease(i / steps)) * 10) / 10, Math.round((y0 + (y - y0) * ease(i / steps)) * 10) / 10).then(() => sleep(16)).then(() => step(i + 1)); return step(1); };
const mainOrder = () => st().windows[W].tabIds.map((id) => st().tabs[id].url);
const smallUrls = () => Object.values(st().tabs).filter((t) => t.windowId === globalThis.__small).map((t) => t.url);`;
