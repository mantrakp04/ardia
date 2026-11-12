export default {
  session: "session-r46-group.json",
  setup: `return sleep(2500).then(() => done({ groups: Object.keys(st().groups || {}) }));`,
  prepare: async (instance) =>
    JSON.parse(await instance.eval(`const W = ac.store.getState().windowOrder[0]; return Promise.all(["g1", "t2", "t3"].map((id) => ac.sidebarRows.measureRow(W, id))).then(([header, first, last]) => JSON.stringify({ header, first, last }));`, { timeout: 20000 })),
  act: `const cx = (r) => Math.round(r.x + r.width * 0.55), cy = (r) => Math.round(r.y + r.height / 2);
return at(760, 520).then(() => sleep(1800))
  .then(() => move(cx(P.header), cy(P.header), 900)).then(() => sleep(400))
  .then(() => { mark("go"); return click(); }).then(() => sleep(1300))
  .then(() => { mark("open"); return click(); }).then(() => sleep(900))
  .then(() => move(760, 520, 900)).then(() => sleep(2600))
  .then(() => done({ rows: P }));`,
  tail: 400,
};
