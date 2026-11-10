export default {
  session: "session-r45-top.json",
  act: `return at(520, 420).then(() => sleep(700))
  .then(() => move(30, 63, 900)).then(() => sleep(1500))
  .then(() => { mark("go"); return click(); }).then(() => sleep(1600))
  .then(() => SIDE === "after" ? move(30, 30, 500).then(() => sleep(500)).then(click) : sleep(1100)).then(() => sleep(1700))
  .then(() => done({ open: st().windows[W].sidebarOpen }));`,
  tail: 500,
};
