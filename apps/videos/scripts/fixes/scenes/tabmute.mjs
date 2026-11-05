export default {
  session: "session-mute.json",
  switches: ["--autoplay-policy=no-user-gesture-required", "--disable-audio-output"],
  instance: { allowAudio: "1" },
  setup: `st().activate("m1"); return sleep(2500).then(() => { st().activate("m2"); return sleep(2500); }).then(() => { st().activate("t2"); return sleep(2500); }).then(() => done({ playing: Object.keys(ac.media.getState().sessions) }));`,
  act: `return at(700, 520).then(() => sleep(400)).then(() => move(45, 256, 800)).then(() => sleep(900)).then(() => { mark("go"); return click(); }).then(() => sleep(2200)).then(() => move(150, 450, 600)).then(() => sleep(900)).then(() => done({ m1: !!st().tabs.m1.muted, m2: !!st().tabs.m2.muted }));`,
  tail: 300,
};
