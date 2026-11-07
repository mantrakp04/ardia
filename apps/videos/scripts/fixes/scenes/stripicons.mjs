export default {
  session: "session-r44-strip.json",
  minWidth: 700,
  setup: `return sleep(2000).then(() => { const g = st().groupTabs(["g1t", "g2t"], { pinned: true, name: "Weekend" }); st().updateGroup(g, { icon: "🌿", color: "green", collapsed: true }); return sleep(1500).then(() => done({ group: st().groups[g] })); });`,
  act: `return at(420, 300).then(() => sleep(600)).then(() => { mark("go"); return sleep(2600); }).then(() => done());`,
  tail: 300,
};
