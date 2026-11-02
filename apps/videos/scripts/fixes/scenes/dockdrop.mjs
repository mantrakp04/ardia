const path = [[246, 20], [240, 21], [228, 22], [212, 22], [196, 22], [182, 21], [172, 20], [168, 20], [168, 20], [168, 20], [168, 20]];

export default {
  session: "session-dock.json",
  setup: `return sleep(1500).then(() => done({ order: st().windows[W].tabIds.slice(0, 5).map((id) => st().tabs[id].title) }));`,
  act: `const dragAlong = (pts) => { const t0 = Date.now(); events.push({ t: t0, down: 1 }); let i = 1; for (let s = 1; s < pts.length; s++) { const [ax, ay] = pts[s - 1]; const [bx, by] = pts[s]; for (let k = 1; k <= 12; k++, i++) events.push({ t: t0 + 150 + i * 16, x: ax + ((bx - ax) * k) / 12, y: ay + ((by - ay) * k) / 12 }); } events.push({ t: t0 + 150 + i * 16, up: 1 }); px = pts.at(-1)[0]; py = pts.at(-1)[1]; return dw("drag:" + pts.map((p) => p.join(",")).join(";")).then(() => sleep(150 + i * 16 + 60)); }; return at(640, 420).then(() => sleep(300)).then(() => move(246, 20, 800)).then(() => sleep(350)).then(() => { mark("go"); return dragAlong(${JSON.stringify(path)}); }).then(() => sleep(500)).then(() => move(420, 260, 600)).then(() => sleep(2000)).then(() => done({ order: st().windows[W].tabIds.slice(0, 5).map((id) => st().tabs[id].title) }));`,
};
