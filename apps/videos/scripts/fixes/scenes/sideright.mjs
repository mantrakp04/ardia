const PALETTE = [1320, 821];
const RIGHT = [1288, 768];
const NO_OPTION = [1262, 788];

export default {
  session: "session-0244n4-side.json",
  setup: `return sleep(1500).then(() => done({ side: st().settings.sidebarSide, active: st().windows[W].activeTabIds.default }));`,
  act: `const end = SIDE === "after" ? ${JSON.stringify(RIGHT)} : ${JSON.stringify(NO_OPTION)};
  return at(900, 700).then(() => sleep(600))
  .then(() => move(${PALETTE.join(", ")}, 800)).then(() => sleep(300))
  .then(() => { mark("go"); return click(); }).then(() => sleep(1300))
  .then(() => move(end[0], end[1], 700)).then(() => sleep(350))
  .then(() => SIDE === "after" ? click() : sleep(90)).then(() => sleep(3000))
  .then(() => done({ side: st().settings.sidebarSide }));`,
  tail: 400,
};
