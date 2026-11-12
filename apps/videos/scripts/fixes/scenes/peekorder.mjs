export default {
  session: "session-0246n2-peek.json",
  setup: `const s = st();
const group = s.groupTabs(["t2"], { pinned: true, name: "Trip" });
s.placeTabs(["t3"], { pinned: true, row: true, beforeId: "t1" });
s.activate("t1");
return sleep(2500).then(() => done({ group, order: st().windows[W].tabIds }));`,
  act: `return sleep(1200).then(() => { mark("peek"); st().openPeek("t1", "http://crumbs.example/"); return sleep(2600); })
  .then(() => { mark("go"); st().peekToTab(W); return sleep(3400); })
  .then(() => done({ order: st().windows[W].tabIds }));`,
  tail: 400,
};
