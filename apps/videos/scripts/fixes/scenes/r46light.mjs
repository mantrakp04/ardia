export default {
  session: "session-r46-light.json",
  setup: `return sleep(2500).then(() => done({ theme: !!st().profiles.default.theme }));`,
  act: `return at(760, 520).then(() => sleep(600)).then(() => { mark("go"); return sleep(1600); })
  .then(() => { st().activate("t4"); return sleep(1800); })
  .then(() => { st().activate("t2"); return sleep(1600); })
  .then(() => done());`,
  tail: 400,
};
