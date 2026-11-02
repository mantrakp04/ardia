export default {
  session: "session-0244n2-group.json",
  setup: `const g = st().groupTabs(["t2", "t3"]); st().updateGroup(g, { name: "Trip", collapsed: false }); globalThis.__group = g; return sleep(1500).then(() => done({ group: g }));`,
  prepare: async (instance) =>
    JSON.parse(await instance.eval(`const W = ac.store.getState().windowOrder[0]; return Promise.all([globalThis.__group, "t2", "t3"].map((id) => ac.sidebarRows.measureRow(W, id))).then(([header, first, last]) => JSON.stringify({ header, first, last }));`, { timeout: 20000 })),
  act: `const cx = (r) => Math.round(r.x + r.width * 0.55), cy = (r) => Math.round(r.y + r.height / 2);
return at(700, 470).then(() => sleep(700))
  .then(() => move(cx(P.header), cy(P.header), 800)).then(() => { mark("go"); return sleep(1200); })
  .then(() => move(cx(P.last), cy(P.last), 700)).then(() => sleep(3200))
  .then(() => move(700, 470, 700)).then(() => sleep(800))
  .then(() => done({ rows: P }));`,
  tail: 400,
};
