export default {
  setup: `const gid = st().groupTabs(["t5", "t6", "t7"], { pinned: false, name: "Snacks" }); st().activate("t3"); return sleep(1500).then(() => done({ gid }));`,
  act: `return at(620, 420).then(() => sleep(300)).then(() => move(90, 313, 800)).then(() => sleep(300)).then(() => { mark("go"); return press("down", "up", 500); }).then(() => sleep(700)).then(() => move(90, 350, 400)).then(() => sleep(200)).then(() => press("down", "up", 500)).then(() => sleep(1800)).then(() => done({ active: st().windows[W].activeTabIds }));`,
};
