export default {
  setup: `const gid = st().groupTabs(["t5", "t6"], { pinned: false, name: "Snacks" }); globalThis.__gid = gid; return sleep(1500).then(() => ac.sidebarRows.measureRow(W, gid)).then((anchor) => { globalThis.__anchor = anchor; return done({ gid, anchor, group: st().groups[gid] }); });`,
  act: `return at(700, 520).then(() => sleep(400)).then(() => { mark("go"); ac.sidebarRows.setSidebarUi({ iconPicker: { windowId: W, kind: "group", id: globalThis.__gid, anchor: globalThis.__anchor }, hover: null }); return sleep(900); }).then(() => move(296, 457, 800)).then(() => sleep(400)).then(() => (SIDE === "after" ? click() : sleep(90))).then(() => sleep(2400)).then(() => done({ icon: st().groups[globalThis.__gid].icon }));`,
};
