export default {
  session: "session-r45-basic.json",
  act: `return at(700, 420).then(() => sleep(900))
  .then(() => { mark("go"); mark(SIDE === "after" ? "Help › Report a Problem…" : "Help › Send Feedback…"); return ac.runCommand({ command: SIDE === "after" ? "reportProblem" : "sendFeedback", arg: null, windowId: W }); }).then(() => sleep(2200))
  .then(() => SIDE === "after" ? move(500, 176, 800).then(() => sleep(250)).then(click).then(() => sleep(400))
    .then(() => [..."tabs flicker after sleep"].reduce((p, ch) => p.then(() => dw("type:" + ch)).then(() => sleep(70)), Promise.resolve())).then(() => sleep(800))
    .then(() => move(663, 113, 700)).then(() => sleep(250)).then(click).then(() => sleep(1300))
    .then(() => move(748, 498, 900)).then(() => sleep(300)).then(click).then(() => sleep(3000))
    : sleep(9500))
  .then(() => done({ tabs: Object.values(st().tabs).map((t) => t.url) }));`,
  tail: 600,
};
