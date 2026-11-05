const CLOSE = [415, 21];

export default {
  session: "session-0244n7-strip.json",
  minWidth: 700,
  setup: `return sleep(2000).then(() => { st().activate("t16"); return sleep(2000); }).then(() => done({ active: st().windows[W].activeTabIds.default }));`,
  act: `const open = () => st().windows[W].tabIds.filter((id) => !st().tabs[id].pinned);
const closed = [];
const before = open();
return at(420, 300).then(() => sleep(900))
  .then(() => move(${CLOSE.join(", ")}, 800)).then(() => sleep(500))
  .then(() => { mark("go"); return click(); }).then(() => sleep(1000))
  .then(() => click()).then(() => sleep(1000))
  .then(() => click()).then(() => sleep(1300))
  .then(() => move(420, 260, 600)).then(() => sleep(1500))
  .then(() => done({ closed: before.filter((id) => !open().includes(id)), active: st().windows[W].activeTabIds.default }));`,
  tail: 400,
};
