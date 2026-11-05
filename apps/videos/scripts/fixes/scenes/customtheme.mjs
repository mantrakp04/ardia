const PALETTE = [1320, 821];

export default {
  session: "session-r44-newtab.json",
  setup: `return sleep(1500).then(() => done({ theme: st().profiles.default.theme || null }));`,
  act: `return at(900, 700).then(() => sleep(500))
  .then(() => move(${PALETTE.join(", ")}, 800)).then(() => sleep(250))
  .then(() => { mark("go"); return click(); }).then(() => sleep(1400))
  .then(() => SIDE === "after" ? move(1300, 568, 800) : move(1287, 598, 800)).then(() => sleep(300))
  .then(() => SIDE === "after" ? click() : sleep(90)).then(() => sleep(1800))
  .then(() => move(1180, 470, 900)).then(() => sleep(700))
  .then(() => sleep(2200))
  .then(() => done({ theme: st().profiles.default.theme || null }));`,
  tail: 400,
};
