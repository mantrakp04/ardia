export default {
  session: "session-frame.json",
  setup: `return sleep(1500).then(() => done());`,
  act: `return sleep(600).then(() => { mark("go"); return sleep(2600); }).then(() => done({ frame: st().windows[W].frame }));`,
  tail: 300,
};
