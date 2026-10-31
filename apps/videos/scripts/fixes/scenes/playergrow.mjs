const STATE = `const sessionOf = () => { const m = (ac.media || {}).getState ? ac.media.getState().sessions : {}; const s = m.t4; return s ? s.playbackState : "none"; };`;

export default {
  session: "session-0243n8-player.json",
  switches: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
  setup: `${STATE} return sleep(3500).then(() => { st().activate("t1"); return sleep(3000); }).then(() => done({ state: sessionOf() }));`,
  act: `${STATE}
return at(700, 470).then(() => sleep(900))
  .then(() => move(120, 790, 700)).then(() => { mark("go"); return sleep(2800); })
  .then(() => move(700, 470, 600)).then(() => sleep(1600))
  .then(() => done({ state: sessionOf() }));`,
  tail: 400,
};
