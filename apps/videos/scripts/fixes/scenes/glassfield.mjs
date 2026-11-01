export default {
  session: "session-0243n8-arc.json",
  setup: `return sleep(2500).then(() => done());`,
  act: `return at(700, 470).then(() => sleep(900))
  .then(() => { mark("go"); return move(129, 106, 700); }).then(() => sleep(2000))
  .then(() => move(150, 63, 500)).then(() => sleep(2000))
  .then(() => move(700, 470, 600)).then(() => sleep(1200))
  .then(() => done());`,
  tail: 400,
};
