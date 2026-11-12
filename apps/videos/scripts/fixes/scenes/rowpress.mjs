export default {
  setup: `return sleep(1500).then(() => done());`,
  act: `return at(150, 166).then(() => sleep(700)).then(() => { mark("go"); return press("down", "up", 260); }).then(() => sleep(1000)).then(() => done());`,
  tail: 500,
};
