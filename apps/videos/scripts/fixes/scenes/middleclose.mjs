export default {
  session: "session-top.json",
  setup: `const ids = ["t4", "t5", "t6", "t3"]; return ids.reduce((p, id) => p.then(() => { st().activate(id); return sleep(1500); }), Promise.resolve()).then(() => done());`,
  act: `return at(640, 420).then(() => sleep(300)).then(() => move(600, 21, 800)).then(() => sleep(300)).then(() => { mark("go"); mark("Middle-click"); return middleClick(); }).then(() => sleep(1300)).then(() => move(430, 21, 500)).then(() => sleep(300)).then(() => { mark("Middle-click"); return middleClick(); }).then(() => sleep(1600)).then(() => done({ tabs: st().windows[W].tabIds.map((id) => st().tabs[id].url) }));`,
  tail: 400,
};
