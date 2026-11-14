export default {
  session: "session-r46-many.json",
  boot: 12000,
  setup: `return sleep(3000).then(() => done({ tabs: st().windows[W].tabIds.length }));`,
  act: `return at(760, 420).then(() => sleep(600))
  .then(() => move(120, 560, 900)).then(() => sleep(300))
  .then(() => { mark("go"); return click(); }).then(() => sleep(700))
  .then(() => move(120, 600, 400)).then(() => sleep(200)).then(() => click()).then(() => sleep(700))
  .then(() => move(120, 520, 400)).then(() => sleep(200)).then(() => click()).then(() => sleep(900))
  .then(() => move(760, 420, 800)).then(() => sleep(400))
  .then(() => key("⌘T", CMD, "t", 17)).then(() => sleep(1600))
  .then(() => key("esc", 0, String.fromCharCode(27), 53)).then(() => sleep(1200))
  .then(() => done({ tabs: st().windows[W].tabIds.length }));`,
  tail: 400,
};
