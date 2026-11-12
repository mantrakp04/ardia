export default {
  session: "session-r44-player.json",
  switches: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
  setup: `return sleep(3500).then(() => { st().activate("t5"); return sleep(3000); }).then(() => done({ media: Object.keys(ac.media.getState().sessions) }));`,
  act: `return at(700, 470).then(() => sleep(800))
  .then(() => { mark("go"); return move(150, 790, 900); }).then(() => sleep(1500))
  .then(() => move(700, 470, 800)).then(() => sleep(3200))
  .then(() => done({ media: Object.values(ac.media.getState().sessions).map((s) => [s.tabId, s.playbackState, s.duration]) }));`,
  tail: 400,
};
