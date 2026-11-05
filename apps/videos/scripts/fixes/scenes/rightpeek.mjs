const PALETTE = [1320, 821];
const RIGHT = [1288, 768];
const NO_OPTION = [1262, 788];

export default {
  session: "session-r44-newtab.json",
  setup: `return sleep(1500).then(() => done({ side: st().settings.sidebarSide }));`,
  act: `const end = SIDE === "after" ? ${JSON.stringify(RIGHT)} : ${JSON.stringify(NO_OPTION)};
  return at(900, 700).then(() => sleep(500))
  .then(() => move(${PALETTE.join(", ")}, 800)).then(() => sleep(250))
  .then(() => { mark("go"); return click(); }).then(() => sleep(1100))
  .then(() => move(end[0], end[1], 650)).then(() => sleep(300))
  .then(() => SIDE === "after" ? click() : sleep(90)).then(() => sleep(1400))
  .then(() => move(700, 420, 700)).then(() => sleep(200)).then(() => click()).then(() => sleep(900))
  .then(() => key("⌘S", CMD, "s", 1)).then(() => sleep(1300))
  .then(() => move(1356, 300, 900)).then(() => sleep(900))
  .then(() => move(1210, 240, 700)).then(() => sleep(700))
  .then(() => move(1200, 330, 700)).then(() => sleep(1600))
  .then(() => done({ side: st().settings.sidebarSide, open: st().windows[W].sidebarOpen }));`,
  tail: 400,
};
