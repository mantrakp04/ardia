export default {
  session: "session-0243n8-top.json",
  setup: `return sleep(2500).then(() => done());`,
  act: `return at(640, 320).then(() => sleep(900))
  .then(() => { mark("go"); return move(139, 21, 700); }).then(() => sleep(1800))
  .then(() => move(102, 21, 400)).then(() => sleep(1600))
  .then(() => move(560, 63, 600)).then(() => sleep(1600))
  .then(() => move(640, 320, 500)).then(() => sleep(900))
  .then(() => done());`,
  tail: 400,
};
