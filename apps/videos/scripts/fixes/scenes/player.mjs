export default {
  session: "session-player.json",
  switches: ["--autoplay-policy=no-user-gesture-required"],
  setup: `return sleep(2500).then(() => { st().activate("t3"); return sleep(3000); }).then(() => done({ media: Object.keys(ac.media.getState().sessions) }));`,
  act: `return at(640, 520).then(() => sleep(1200)).then(() => move(98, 790, 800)).then(() => { mark("go"); return sleep(3200); }).then(() => move(150, 791, 500)).then(() => sleep(1200)).then(() => move(560, 600, 700)).then(() => sleep(500)).then(() => done({ media: Object.keys(ac.media.getState().sessions) }));`,
  tail: 300,
};
