export default {
  session: "session-r45-basic.json",
  act: `return at(700, 420).then(() => sleep(700))
  .then(() => move(420, 30, 900)).then(() => sleep(400))
  .then(() => { mark("go"); return click(); }).then(() => sleep(1700))
  .then(() => move(130, 560, 900)).then(() => sleep(300)).then(click).then(() => sleep(1800))
  .then(() => move(420, 30, 900)).then(() => sleep(300)).then(() => SIDE === "after" ? click() : null).then(() => sleep(1500))
  .then(() => move(560, 420, 600)).then(() => sleep(300)).then(() => key("esc", 0, String.fromCharCode(27), 53)).then(() => sleep(1800))
  .then(() => done({}));`,
  tail: 500,
};
