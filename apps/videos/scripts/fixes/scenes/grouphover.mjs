export default {
  setup: `const gid = st().groupTabs(["t4", "t5", "t6", "t7"], { pinned: false, name: "Weekend" }); const nested = st().groupTabs(["t4", "t5"], { pinned: false, name: "Recipes" }); st().activate("t3"); return sleep(1500).then(() => done({ gid, nested, parent: st().groups[nested].parentId }));`,
  act: `hover = SIDE === "after"; return at(640, 460).then(() => sleep(300)).then(() => move(96, 203, 800)).then(() => { mark("go"); return sleep(1600); }).then(() => move(112, 241, 500)).then(() => sleep(1300)).then(() => move(640, 460, 700)).then(() => (hover ? ac.shell.devSetPointer(W, null) : null)).then(() => sleep(1500)).then(() => done());`,
};
