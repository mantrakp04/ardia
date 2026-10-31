export default {
  session: "session-0243n7.json",
  switches: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
  setup: `return sleep(2500).then(() => { st().activate("t5"); return sleep(2500); }).then(() => done());`,
  act: `return at(700, 470).then(() => sleep(900))
  .then(() => { mark("go"); return move(130, 75, 700); }).then(() => sleep(2200))
  .then(() => move(700, 470, 600)).then(() => sleep(900))
  .then(() => { mark("downloads"); st().setDownloadsOpen(W, true); return sleep(2600); })
  .then(() => { st().setDownloadsOpen(W, false); return sleep(1000); })
  .then(() => done());`,
  tail: 400,
};
